/**
 * Tests for the controls added after the first submission: the proxy guard, the
 * agreed callback, the webhook trust model, and the audit export.
 *
 * They are grouped by what a reviewer would want to disprove, and most of them
 * assert a refusal rather than a success. A voice agent that places calls on
 * somebody's account is only as good as the things it declines to do.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { INCIDENT_SCENARIOS } from '../src/data/scenarios.js';
import { CalleIncidentCommander } from '../src/agents/calleService.js';
import { EscalationLadder } from '../src/agents/escalationLadder.js';
import { buildAuditRecord, auditFileName } from '../src/agents/auditTrail.js';
import {
  guardProxyRequest,
  classifyRoute,
  readAllowedNumbers,
  RateLimiter,
  LIMITS
} from '../api/_lib/proxyGuard.js';
import { IncidentStore } from '../api/_lib/incidentStore.js';
import { handleWebhookDelivery, parseWebhookDelivery } from '../api/_lib/webhookReceiver.js';

const SCENARIO = INCIDENT_SCENARIOS['fintech-race'];

const ROTA = [
  { id: 'primary', name: 'Priya Raman', role: 'primary on-call engineer', phone: '+919876543210' },
  { id: 'backup', name: 'Sam Okoro', role: 'backup on-call engineer', phone: '+14155552671' }
];

/** Builds a create-call payload of the shape the app actually sends. */
function createPayload(phone = '+919876543210', overrides = {}) {
  return Buffer.from(JSON.stringify({
    task: 'Page the on-call engineer.',
    recipient: { phone },
    metadata: { incident_id: 'inc-1', contact_id: 'primary' },
    ...overrides
  }));
}

test('36. The proxy forwards only the routes the ladder uses', () => {
  assert.equal(classifyRoute('POST', '/v1/calls').kind, 'create');
  assert.equal(classifyRoute('GET', '/v1/calls/call_123').kind, 'read');
  assert.equal(classifyRoute('GET', '/v1/calls/call_123/events').kind, 'read');

  // Everything else on the account stays unreachable through the proxy. A
  // credential-attaching relay that forwards whatever path it is given is an
  // open gateway to the whole API, not a backend for one application.
  assert.equal(classifyRoute('GET', '/v1/goals').allowed, false);
  assert.equal(classifyRoute('DELETE', '/v1/calls/call_123').allowed, false);
  assert.equal(classifyRoute('POST', '/v1/calls/call_123/cancel').allowed, false);
  assert.equal(classifyRoute('GET', '/v1/account').allowed, false);

  const verdict = guardProxyRequest({
    method: 'GET',
    pathname: '/v1/goals',
    limiter: new RateLimiter(),
    enforceRecipientAllowlist: true
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.status, 404);
  assert.equal(verdict.error.code, 'route_not_proxied');
});

test('37. A public deployment rings only the numbers its owner nominated', () => {
  const env = {
    CALLE_ROTA_PRIMARY_PHONE: '+91 98765 43210',
    CALLE_DEMO_ALLOWED_NUMBERS: '+14155552671'
  };

  // Formatting differences must not decide who can be called, so the allowlist
  // is compared after the same normalisation the dialler applies.
  assert.deepEqual(readAllowedNumbers(env), ['+14155552671', '+919876543210']);

  const allowedCall = guardProxyRequest({
    method: 'POST',
    pathname: '/v1/calls',
    body: createPayload('+91-98765-43210'),
    env,
    limiter: new RateLimiter(),
    enforceRecipientAllowlist: true
  });
  assert.equal(allowedCall.ok, true, 'a nominated number is dialled whatever way it is written');

  const strangerCall = guardProxyRequest({
    method: 'POST',
    pathname: '/v1/calls',
    body: createPayload('+442071838750'),
    env,
    limiter: new RateLimiter(),
    enforceRecipientAllowlist: true
  });
  assert.equal(strangerCall.ok, false, 'a hosted demo must not be usable as an anonymous dialler');
  assert.equal(strangerCall.status, 403);
  assert.equal(strangerCall.error.code, 'recipient_not_allowed');

  // An unconfigured deployment refuses every call rather than allowing every
  // call. Failing open here would mean a forgotten environment variable turns
  // the link in a submission into a public dialler.
  const unconfigured = guardProxyRequest({
    method: 'POST',
    pathname: '/v1/calls',
    body: createPayload('+14155552671'),
    env: {},
    limiter: new RateLimiter(),
    enforceRecipientAllowlist: true
  });
  assert.equal(unconfigured.ok, false);
  assert.equal(unconfigured.error.code, 'no_numbers_allowed');

  // A dev server holds the operator's own key and dials the operator's own
  // phone, so it is not restricted to a list the operator would have to keep.
  const local = guardProxyRequest({
    method: 'POST',
    pathname: '/v1/calls',
    body: createPayload('+442071838750'),
    env,
    limiter: new RateLimiter(),
    enforceRecipientAllowlist: false
  });
  assert.equal(local.ok, true);
});

test('38. A call through the proxy must belong to an incident', () => {
  const env = { CALLE_DEMO_ALLOWED_NUMBERS: '+14155552671' };

  const noMetadata = guardProxyRequest({
    method: 'POST',
    pathname: '/v1/calls',
    body: Buffer.from(JSON.stringify({ task: 'Call this person.', recipient: { phone: '+14155552671' } })),
    env,
    limiter: new RateLimiter(),
    enforceRecipientAllowlist: true
  });
  assert.equal(noMetadata.ok, false);
  assert.equal(noMetadata.error.code, 'missing_incident_metadata');

  const hugeTask = guardProxyRequest({
    method: 'POST',
    pathname: '/v1/calls',
    body: createPayload('+14155552671', { task: 'x'.repeat(9000) }),
    env,
    limiter: new RateLimiter(),
    enforceRecipientAllowlist: true
  });
  assert.equal(hugeTask.ok, false);
  assert.equal(hugeTask.error.code, 'task_too_long');
});

test('39. The proxy bounds how many calls one address can place', () => {
  const env = { CALLE_DEMO_ALLOWED_NUMBERS: '+14155552671' };
  const limiter = new RateLimiter();
  const call = () => guardProxyRequest({
    method: 'POST',
    pathname: '/v1/calls',
    body: createPayload('+14155552671'),
    env,
    clientId: '203.0.113.7',
    limiter,
    enforceRecipientAllowlist: true
  });

  for (let i = 0; i < LIMITS.create.max; i++) {
    assert.equal(call().ok, true, `call ${i + 1} is within the budget`);
  }

  const refused = call();
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 429);
  assert.ok(refused.retryAfterSeconds > 0, 'a refusal says when to come back');

  // Reading call state is polled far more often than a call is placed, so the
  // two budgets are separate. A rate limit that killed polling would make the
  // ladder unreadable long before it stopped anyone dialling.
  const read = guardProxyRequest({
    method: 'GET',
    pathname: '/v1/calls/call_123',
    env,
    clientId: '203.0.113.7',
    limiter,
    enforceRecipientAllowlist: true
  });
  assert.equal(read.ok, true, 'exhausting the call budget must not stop reading call state');
});

test('40. An engineer who asks for time is not escalated past', async () => {
  const svc = new CalleIncidentCommander(null);

  const deferred = svc.interpretDecision({
    structuredResult: {
      answered_by: 'named_engineer',
      decision: 'no_decision',
      reason: 'I want to read the diff first.',
      callback_minutes: 10
    },
    completionConfidence: { score: 0.88, label: 'high' },
    taskCompleted: true
  });

  assert.equal(deferred.requestedCallback, true);
  assert.equal(deferred.callbackMinutes, 10);
  assert.equal(deferred.authorised, false, 'asking for time never authorises anything');
  assert.equal(deferred.shouldEscalate, false, 'waking the backup would contradict the person who answered');

  // A weakly extracted callback request is not a reason to stop the ladder. The
  // cost of mishearing "call me back" is a live incident sitting on a timer
  // with nobody else told, so an unclear call escalates as it did before.
  const unsure = svc.interpretDecision({
    structuredResult: {
      answered_by: 'named_engineer',
      decision: 'no_decision',
      callback_minutes: 10
    },
    completionConfidence: { score: 0.2, label: 'low' },
    taskCompleted: true
  });
  assert.equal(unsure.requestedCallback, false);
  assert.equal(unsure.shouldEscalate, true);

  // Nor is a callback request from somebody who is not the named engineer.
  const colleague = svc.interpretDecision({
    structuredResult: {
      answered_by: 'different_person',
      decision: 'no_decision',
      callback_minutes: 5
    },
    completionConfidence: { score: 0.9, label: 'high' },
    taskCompleted: true
  });
  assert.equal(colleague.requestedCallback, false);
  assert.equal(colleague.shouldEscalate, true);
});

test('41. The ladder calls back rather than climbing, and only once', async () => {
  const attempts = [];

  const service = {
    isLiveMode: true,
    placeIncidentCall: async ({ contact, attempt, callbackMinutes }) => {
      attempts.push({ contactId: contact.id, attempt, callbackMinutes });
      return {
        mode: 'live',
        callId: `call_${contact.id}_${attempt}`,
        idempotencyKey: new CalleIncidentCommander(null).buildIdempotencyKey('inc-cb', contact.id, attempt),
        attempt
      };
    },
    pollCall: async (callId) => ({ callId, status: 'completed', isTerminal: true, transcript: [] }),
    interpretDecision: (snapshot) => {
      // First call to the primary defers. The callback authorises.
      if (snapshot.callId === 'call_primary_1') {
        return {
          decision: 'no_decision', answeredBy: 'named_engineer', reachedEngineer: true,
          authorised: false, shouldEscalate: false, requestedCallback: true,
          callbackMinutes: 10, reason: 'Wants to read the diff.', confidence: 0.9
        };
      }
      return {
        decision: 'deploy_hotfix', answeredBy: 'named_engineer', reachedEngineer: true,
        authorised: true, shouldEscalate: false, requestedCallback: false,
        reason: 'Read it, ship it.', confidence: 0.94
      };
    }
  };

  const events = [];
  const ladder = new EscalationLadder({
    service,
    pollIntervalMs: 1,
    onEvent: (e) => events.push(e),
    // Resolves the agreed wait immediately, so the test exercises the decision
    // to wait rather than the waiting itself.
    callbackClock: () => Promise.resolve()
  });

  const outcome = await ladder.run({ scenario: SCENARIO, contacts: ROTA, incidentId: 'inc-cb' });

  assert.equal(outcome.authorised, true);
  assert.equal(outcome.decidedBy.id, 'primary', 'the primary decided, so the backup was never woken');
  assert.deepEqual(attempts.map((a) => a.contactId), ['primary', 'primary']);
  assert.equal(attempts[1].attempt, 2);
  assert.equal(attempts[1].callbackMinutes, 10, 'the second call knows it is the agreed callback');
  assert.ok(events.some((e) => e.type === 'rung:callback-scheduled'));
  assert.ok(!events.some((e) => e.type === 'rung:dialing' && e.contact.id === 'backup'),
    'the backup must not be dialled while the primary is deciding');

  // Both calls are in the trail. "The primary authorised at 03:23" without the
  // deferral at 03:12 hides the only fact that explains the gap.
  assert.equal(outcome.rungs.length, 2);
  assert.equal(outcome.rungs[0].callback.requestedMinutes, 10);
  assert.equal(outcome.rungs[0].callback.endedBy, 'elapsed');
});

test('42. A second deferral from the same person escalates', async () => {
  const dialled = [];

  const service = {
    isLiveMode: true,
    placeIncidentCall: async ({ contact, attempt }) => {
      dialled.push(`${contact.id}:${attempt}`);
      return { mode: 'live', callId: `call_${contact.id}_${attempt}`, idempotencyKey: 'k', attempt };
    },
    pollCall: async (callId) => ({ callId, status: 'completed', isTerminal: true, transcript: [] }),
    interpretDecision: (snapshot) => {
      if (snapshot.callId.startsWith('call_primary')) {
        return {
          decision: 'no_decision', answeredBy: 'named_engineer', reachedEngineer: true,
          authorised: false, shouldEscalate: false, requestedCallback: true,
          callbackMinutes: 10, reason: 'Still not ready.', confidence: 0.9
        };
      }
      return {
        decision: 'deploy_hotfix', answeredBy: 'named_engineer', reachedEngineer: true,
        authorised: true, shouldEscalate: false, requestedCallback: false,
        reason: 'Ship it.', confidence: 0.9
      };
    }
  };

  const events = [];
  const ladder = new EscalationLadder({
    service,
    pollIntervalMs: 1,
    onEvent: (e) => events.push(e),
    callbackClock: () => Promise.resolve()
  });

  const outcome = await ladder.run({ scenario: SCENARIO, contacts: ROTA, incidentId: 'inc-cb2' });

  assert.deepEqual(dialled, ['primary:1', 'primary:2', 'backup:1'],
    'one callback is a slow decision, two is a decision that is not coming');
  assert.ok(events.some((e) => e.type === 'rung:callback-refused'));
  assert.equal(outcome.decidedBy.id, 'backup');
  assert.match(outcome.rungs[1].outcome.reason, /already been given one callback/);
});

test('43. A callback is a new request, and every other retry is still deduplicated', () => {
  const svc = new CalleIncidentCommander(null);

  const first = svc.buildIdempotencyKey('inc-1', 'primary');
  assert.equal(first, svc.buildIdempotencyKey('inc-1', 'primary', 1), 'the first page keeps its original key');
  assert.equal(first, svc.buildIdempotencyKey('inc-1', 'primary'), 'a retry of the first page never dials twice');

  const callback = svc.buildIdempotencyKey('inc-1', 'primary', 2);
  assert.notEqual(callback, first, 'an agreed callback is a different request, not a retry');
  assert.equal(callback, svc.buildIdempotencyKey('inc-1', 'primary', 2), 'and it is itself retry-safe');
});

test('44. The callback brief tells the engineer it is the call they asked for', () => {
  const svc = new CalleIncidentCommander(null);
  const contact = { id: 'primary', name: 'Priya Raman', role: 'primary on-call engineer', phone: '+919876543210' };

  const first = svc.buildTaskPrompt(SCENARIO, contact, {});
  assert.ok(!/callback you agreed/i.test(first));

  const callback = svc.buildTaskPrompt(SCENARIO, contact, { callbackMinutes: 10 });
  assert.match(callback, /callback you agreed/i);
  assert.match(callback, /10 minute/);
  assert.match(callback, /Do not repeat the full briefing/i,
    'the second call must not read the same script at somebody who already heard it');
});

test('45. A webhook delivery is never believed, only the API is', async () => {
  const store = new IncidentStore();

  // A forged delivery, shaped exactly like a real one, claiming the named
  // engineer authorised a deploy. The platform does not sign webhooks, so this
  // is a POST anybody who guesses the URL can send.
  const forged = JSON.stringify({
    id: 'evt_forged',
    type: 'call.completed',
    created_at: '2026-09-11T03:12:00Z',
    data: {
      id: 'call_real',
      status: 'completed',
      structured_result: { answered_by: 'named_engineer', decision: 'deploy_hotfix' },
      completion_confidence: { score: 0.99 }
    }
  });

  const result = await handleWebhookDelivery({
    rawBody: forged,
    env: {},
    store,
    // What the account actually holds for that call: nobody answered.
    verifyCall: async (callId) => ({
      snapshot: {
        callId, status: 'completed', isTerminal: true,
        structuredResult: { answered_by: 'no_answer', decision: 'no_decision' },
        completionConfidence: { score: 0.9 },
        taskCompleted: true,
        transcript: []
      },
      outcome: new CalleIncidentCommander(null).interpretDecision({
        structuredResult: { answered_by: 'no_answer', decision: 'no_decision' },
        completionConfidence: { score: 0.9 },
        taskCompleted: true
      }),
      metadata: { incident_id: 'inc-forged', contact_id: 'primary' }
    })
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.authorised, false, 'a deploy cannot be authorised by sending a JSON document');

  const recorded = store.get('inc-forged');
  assert.equal(recorded.calls[0].answeredBy, 'no_answer', 'the audit trail records the API, not the delivery');
  assert.equal(recorded.calls[0].decision, 'no_decision');
  assert.equal(recorded.calls[0].verifiedFromApi, true);
});

test('46. A delivery naming a call this account cannot read changes nothing', async () => {
  const store = new IncidentStore();

  const result = await handleWebhookDelivery({
    rawBody: JSON.stringify({ id: 'evt_1', type: 'call.completed', data: { id: 'call_nonexistent' } }),
    env: {},
    store,
    verifyCall: async () => null
  });

  assert.equal(result.status, 200, 'acknowledged, so it is not retried forever');
  assert.equal(result.body.recorded, false);
  assert.equal(store.get('inc-anything'), null);

  // A body that cannot be parsed is refused outright rather than retried.
  assert.equal(parseWebhookDelivery('not json').ok, false);
  assert.equal(parseWebhookDelivery(JSON.stringify({ id: 'evt', type: 'call.completed' })).ok, false,
    'a delivery with no call id gives nothing to verify against');
});

test('47. A redelivered webhook event is recorded once', async () => {
  const store = new IncidentStore();
  let reads = 0;

  const deliver = () => handleWebhookDelivery({
    rawBody: JSON.stringify({ id: 'evt_same', type: 'call.completed', data: { id: 'call_1' } }),
    env: {},
    store,
    verifyCall: async (callId) => {
      reads++;
      return {
        snapshot: { callId, status: 'completed', transcript: [] },
        outcome: { decision: 'deploy_hotfix', answeredBy: 'named_engineer', authorised: true, reason: 'Ship it.', confidence: 0.9 },
        metadata: { incident_id: 'inc-dupe', contact_id: 'primary' }
      };
    }
  });

  const first = await deliver();
  const second = await deliver();

  assert.equal(first.body.recorded, true);
  assert.equal(second.body.duplicate, true);
  assert.equal(reads, 1, 'a duplicate is dropped before the side effect, not after');
  assert.equal(store.get('inc-dupe').calls.length, 1);
});

test('48. A configured webhook token keeps unsolicited traffic out', async () => {
  const store = new IncidentStore();
  const env = { CALLE_WEBHOOK_TOKEN: 'shared-secret' };
  const body = JSON.stringify({ id: 'evt_2', type: 'call.completed', data: { id: 'call_2' } });

  const wrong = await handleWebhookDelivery({ rawBody: body, token: 'guess', env, store, verifyCall: async () => null });
  assert.equal(wrong.status, 401);

  const right = await handleWebhookDelivery({ rawBody: body, token: 'shared-secret', env, store, verifyCall: async () => null });
  assert.equal(right.status, 200);
});

test('49. Time to decision is measured from the page, not from the call', async () => {
  const service = {
    isLiveMode: true,
    placeIncidentCall: async ({ contact }) => ({ mode: 'live', callId: `call_${contact.id}`, idempotencyKey: 'k' }),
    pollCall: async (callId) => ({ callId, status: 'completed', isTerminal: true, transcript: [] }),
    interpretDecision: () => ({
      decision: 'deploy_hotfix', answeredBy: 'named_engineer', reachedEngineer: true,
      authorised: true, shouldEscalate: false, requestedCallback: false, reason: 'Ship it.', confidence: 0.9
    })
  };

  const ladder = new EscalationLadder({ service, pollIntervalMs: 1 });
  const outcome = await ladder.run({ scenario: SCENARIO, contacts: [ROTA[0]], incidentId: 'inc-timing' });

  assert.ok(outcome.pagedAt, 'the clock starts when the page is raised');
  assert.ok(outcome.decidedAt);
  assert.equal(typeof outcome.elapsedMs, 'number');
  assert.ok(outcome.elapsedMs >= 0);
  assert.ok(new Date(outcome.decidedAt) >= new Date(outcome.pagedAt));
  assert.equal(typeof outcome.rungs[0].durationMs, 'number', 'each rung is timed too');

  // An exhausted rota is timed as well. How long production ran undecided is
  // the number under review whether or not anybody ever picked up.
  const silent = new EscalationLadder({
    service: { ...service, interpretDecision: () => ({
      decision: 'no_decision', answeredBy: 'no_answer', reachedEngineer: false,
      authorised: false, shouldEscalate: true, requestedCallback: false, reason: 'Nobody answered.', confidence: null
    }) },
    pollIntervalMs: 1
  });
  const nobody = await silent.run({ scenario: SCENARIO, contacts: ROTA, incidentId: 'inc-silent' });
  assert.equal(typeof nobody.elapsedMs, 'number');
});

test('50. The audit export says what it is before it says what happened', () => {
  const outcome = {
    resolved: true,
    authorised: true,
    decision: 'deploy_hotfix',
    reason: 'Row lock is the right fix.',
    decidedBy: { id: 'backup', name: 'Sam Okoro', role: 'backup on-call engineer', phone: '+14155552671' },
    confidence: 0.94,
    pagedAt: '2026-09-11T03:10:00.000Z',
    decidedAt: '2026-09-11T03:23:30.000Z',
    elapsedMs: 810000,
    rungs: [
      {
        index: 0, attempt: 1, mode: 'live', callId: 'call_a',
        contact: { id: 'primary', name: 'Priya Raman', role: 'primary on-call engineer', phone: '+919876543210' },
        outcome: { decision: 'no_decision', answeredBy: 'voicemail_or_ivr', authorised: false, reason: 'Voicemail.' },
        snapshot: { transcript: [{ speaker: 'CALL-E', text: 'Voicemail detected.' }] }
      },
      {
        index: 1, attempt: 1, mode: 'live', callId: 'call_b',
        contact: { id: 'backup', name: 'Sam Okoro', role: 'backup on-call engineer', phone: '+14155552671' },
        outcome: { decision: 'deploy_hotfix', answeredBy: 'named_engineer', authorised: true, reason: 'Ship it.', confidence: 0.94 },
        snapshot: { transcript: [{ speaker: 'Sam Okoro', text: 'Deploy it.' }], taskCompleted: true }
      }
    ]
  };

  const live = buildAuditRecord({ scenario: SCENARIO, outcome, incidentId: 'inc-9', isLive: true, connectionMode: 'server-proxied' });

  assert.equal(live.run.live, true);
  assert.equal(live.authorisation.authorised, true);
  assert.equal(live.authorisation.decidedBy.phone, '+14155552671', 'which handset rang is what gets disputed');
  assert.equal(live.timings.elapsedMs, 810000);
  assert.equal(live.gate.satisfied, true);

  // Every rung, not only the one that answered. The primary reaching voicemail
  // is the finding a rota review exists to catch.
  assert.equal(live.rungs.length, 2);
  assert.equal(live.rungs[0].answeredBy, 'voicemail_or_ivr');
  assert.equal(live.rungs[0].callPlaced, true);
  assert.equal(live.rungs[1].transcript[0].text, 'Deploy it.');

  // A run with no phone call in it says so in the file, because the file
  // outlives the interface that labelled it on screen.
  const simulated = buildAuditRecord({ scenario: SCENARIO, outcome, incidentId: 'inc-9', isLive: false });
  assert.equal(simulated.run.live, false);
  assert.match(simulated.run.note, /No call was placed/);

  // With no ladder outcome at all, the export still states the gate held.
  const never = buildAuditRecord({ scenario: SCENARIO, outcome: null, incidentId: 'inc-0', isLive: true });
  assert.equal(never.authorisation.authorised, false);
  assert.equal(never.gate.satisfied, false);
  assert.match(never.gate.outcome, /not applied to production/);

  assert.equal(auditFileName('inc-9'), 'calle-audit-inc-9.json');
  assert.equal(auditFileName('../../etc/passwd'), 'calle-audit-etcpasswd.json',
    'a filename is built from the id, never taken from it');
});
