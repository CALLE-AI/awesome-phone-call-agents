// End-to-end tests that drive the REAL Zapier app definition (index.js) through
// zapier-platform-core's createAppTester, rather than calling operation.perform
// directly. This exercises the parts a hand-rolled fake z object cannot: the
// beforeRequest/afterResponse middleware chain, the real z.request client, and
// performResume the way the Zapier runtime actually drives it.
//
// Everything targets the local fake CALL-E server on 127.0.0.1. No real
// network access, no credentials.
import { describe, it, expect, afterEach } from 'vitest';
import { createAppTester } from 'zapier-platform-core';

import App from '../index.js';
import { startFakeCalle } from './fake-calle-server.js';

const appTester = createAppTester(App);

let server;
afterEach(async () => {
  if (server) await server.close();
  server = null;
});

const authData = (apiKey) => ({ apiKey, baseUrl: server.url });

// dry_run is explicitly false here because it defaults to a dry run: placing a
// real call takes a deliberate opt-in, and these tests are the ones opting in.
const CALL_INPUT = { task: 'Call the on-call engineer.', phone: '+15550123456', dry_run: false };

const COMPLETED_RECORD = {
  status: 'completed',
  task_completed: true,
  completion_confidence: { score: 0.95, label: 'high' },
  structured_result: { acknowledged: 'yes' },
  completed_at: '2026-08-02T00:05:00Z',
};

describe('authentication through the real Zapier runtime', () => {
  it('sends the Bearer header built by beforeRequest and succeeds against /v1/goals', async () => {
    server = await startFakeCalle({});

    await appTester(App.authentication.test, { authData: authData('test-key-123') });

    expect(server.lastRequest().method).toBe('GET');
    expect(server.lastRequest().path).toBe('/v1/goals');
    expect(server.lastRequest().headers.authorization).toBe('Bearer test-key-123');
  });

  it('turns a rejected key into a friendly error, proving afterResponse is wired', async () => {
    server = await startFakeCalle({});

    // No apiKey means addBearerHeader sends no Authorization header at all,
    // which the fake server already treats as unauthorized (401).
    await expect(
      appTester(App.authentication.test, { authData: { baseUrl: server.url } }),
    ).rejects.toThrow(/API key/i);
  });
});

describe('start_call through the real Zapier runtime', () => {
  it('posts to /v1/calls with an idempotency key and returns a call id', async () => {
    server = await startFakeCalle({});

    const output = await appTester(App.creates.start_call.operation.perform, {
      authData: authData('k'),
      inputData: CALL_INPUT,
    });

    expect(server.lastRequest().method).toBe('POST');
    expect(server.lastRequest().path).toBe('/v1/calls');
    expect(server.lastRequest().headers['idempotency-key']).toMatch(/^[0-9a-f]{64}$/);
    expect(output.call_id).toMatch(/^call_/);
  });

  it('makes zero network requests in dry-run mode', async () => {
    server = await startFakeCalle({});

    const output = await appTester(App.creates.start_call.operation.perform, {
      authData: authData('k'),
      inputData: { ...CALL_INPUT, dry_run: true },
    });

    expect(output.dry_run).toBe(true);
    expect(server.lastRequest()).toBe(null);
  });

  it('makes zero network requests when dry_run is left unset', async () => {
    server = await startFakeCalle({});
    const { dry_run: _omitted, ...withoutDryRun } = CALL_INPUT;

    const output = await appTester(App.creates.start_call.operation.perform, {
      authData: authData('k'),
      inputData: withoutDryRun,
    });

    expect(output.dry_run).toBe(true);
    expect(server.lastRequest()).toBe(null);
  });
});

describe('place_call_and_wait through the real Zapier runtime', () => {
  // z.generateCallbackUrl() under createAppTester does not return a URL that
  // routes back to our fake server - the tester hardcodes it to a fixed
  // Zapier-hosted echo endpoint (see zapier-platform-core's
  // src/tools/create-app-tester.js and src/tools/create-callback-wrapper.js).
  // Actually delivering an HTTP webhook to that address is Zapier-hosted
  // infrastructure outside this app's code, so it cannot be driven here.
  // What we CAN and DO verify through the real runtime:
  //   - perform() asks for a callback URL and sends it to CALL-E as webhook_url.
  //   - performResume() is invoked by the platform with bundle.cleanedRequest
  //     set from the (would-be) webhook body and bundle.outputData carried over
  //     from perform() - exactly the shape the platform hands it - and the app's
  //     fail-closed matching logic runs under the real checkOutput/callback
  //     middleware chain, not a hand-rolled fake.
  const completedEvent = (callId) => ({
    id: 'evt_1',
    type: 'call.completed',
    data: {
      id: callId,
      status: 'completed',
      task_completed: true,
      completion_confidence: { score: 0.95, label: 'high' },
      structured_result: { acknowledged: 'yes' },
      metadata: { correlation_id: 'incident-42' },
      recipients: [],
    },
  });

  it('completes the callback cycle to a confirmed, actionable disposition', async () => {
    server = await startFakeCalle({});

    const performed = await appTester(App.creates.place_call_and_wait.operation.perform, {
      authData: authData('k'),
      inputData: CALL_INPUT,
    });

    expect(server.lastRequest().body.webhook_url).toBeTruthy();

    // The call really did finish, so CALL-E's own record says so too.
    server.setStatus(performed.call_id, COMPLETED_RECORD);

    const resumed = await appTester(App.creates.place_call_and_wait.operation.performResume, {
      authData: authData('k'),
      outputData: performed,
      cleanedRequest: completedEvent(performed.call_id),
    });

    expect(resumed.disposition).toBe('confirmed');
    expect(resumed.is_actionable).toBe(true);
    expect(resumed.verified).toBe(true);
    // The resume made its own authenticated GET back to CALL-E, through the
    // real middleware chain - Bearer header and all.
    expect(server.lastRequest().method).toBe('GET');
    expect(server.lastRequest().path).toBe(`/v1/calls/${performed.call_id}`);
    expect(server.lastRequest().headers.authorization).toBe('Bearer k');
  });

  // The whole reason the resume re-reads the call: the callback body is
  // unsigned, so a body claiming a clean success proves nothing on its own.
  it('refuses to confirm a callback that CALL-E does not back up', async () => {
    server = await startFakeCalle({});

    const performed = await appTester(App.creates.place_call_and_wait.operation.perform, {
      authData: authData('k'),
      inputData: CALL_INPUT,
    });

    // The record is left exactly as CALL-E created it - still queued - while
    // the callback body insists the call completed with a clean result.
    const resumed = await appTester(App.creates.place_call_and_wait.operation.performResume, {
      authData: authData('k'),
      outputData: performed,
      cleanedRequest: completedEvent(performed.call_id),
    });

    expect(resumed.is_actionable).toBe(false);
    expect(resumed.disposition).not.toBe('confirmed');
  });

  it('fails closed when CALL-E has no record of the call the callback names', async () => {
    server = await startFakeCalle({});

    const resumed = await appTester(App.creates.place_call_and_wait.operation.performResume, {
      authData: authData('k'),
      outputData: { call_id: 'call_never_placed' },
      cleanedRequest: completedEvent('call_never_placed'),
    });

    expect(resumed.disposition).toBe('needs_human');
    expect(resumed.is_actionable).toBe(false);
    expect(resumed.verified).toBe(false);
  });

  it('fails closed when the callback describes a different call than the one started', async () => {
    server = await startFakeCalle({});

    const performed = await appTester(App.creates.place_call_and_wait.operation.perform, {
      authData: authData('k'),
      inputData: CALL_INPUT,
    });

    const resumed = await appTester(App.creates.place_call_and_wait.operation.performResume, {
      outputData: performed,
      cleanedRequest: completedEvent('call_totally_different'),
    });

    expect(resumed.disposition).toBe('needs_human');
    expect(resumed.is_actionable).toBe(false);
  });
});

describe('find_call_result through the real Zapier runtime', () => {
  it('returns exactly one confirmed result once the call completes', async () => {
    server = await startFakeCalle({});

    const performed = await appTester(App.creates.start_call.operation.perform, {
      authData: authData('k'),
      inputData: CALL_INPUT,
    });

    server.setStatus(performed.call_id, COMPLETED_RECORD);

    const results = await appTester(App.searches.find_call_result.operation.perform, {
      authData: authData('k'),
      inputData: { call_id: performed.call_id },
    });

    expect(results).toHaveLength(1);
    expect(results[0].disposition).toBe('confirmed');
  });
});
