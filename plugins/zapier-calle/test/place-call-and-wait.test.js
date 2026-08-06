import { describe, it, expect, afterEach, vi } from 'vitest';
import { startFakeCalle } from './fake-calle-server.js';
import placeCallAndWait from '../creates/place-call-and-wait.js';

let server;
afterEach(async () => {
  if (server) await server.close();
  server = null;
});

const CALLBACK = 'https://hooks.zapier.com/callback/abc';

const zFor = (calls = []) => ({
  generateCallbackUrl: () => {
    calls.push('generated');
    return CALLBACK;
  },
  request: async (options) => {
    const response = await fetch(options.url, {
      method: options.method || 'GET',
      headers: { 'content-type': 'application/json', authorization: 'Bearer k', ...(options.headers || {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    return { status: response.status, data: await response.json() };
  },
});

// Dialing is opt-in, so the tests that expect a real call say so explicitly.
const input = { task: 'Call the on-call engineer.', phone: '+15550123456', dry_run: false };

describe('place-call-and-wait perform', () => {
  it('mints no callback url and places no call when dry_run was never set', async () => {
    server = await startFakeCalle({});
    const generated = [];
    const { dry_run: _omitted, ...withoutDryRun } = input;
    const output = await placeCallAndWait.operation.perform(zFor(generated), {
      authData: { apiKey: 'k', baseUrl: server.url },
      inputData: withoutDryRun,
    });

    expect(output.dry_run).toBe(true);
    expect(generated).toEqual([]);
    expect(server.lastRequest()).toBe(null);
  });

  it('passes the Zapier callback url to CALL-E as webhook_url', async () => {
    server = await startFakeCalle({});
    const output = await placeCallAndWait.operation.perform(zFor(), {
      authData: { apiKey: 'k', baseUrl: server.url },
      inputData: input,
    });

    expect(server.lastRequest().body.webhook_url).toBe(CALLBACK);
    expect(output.call_id).toMatch(/^call_/);
    expect(output.disposition).toBe('outcome_unknown');
  });

  it('does not generate a callback url in dry-run mode', async () => {
    server = await startFakeCalle({});
    const generated = [];
    const output = await placeCallAndWait.operation.perform(zFor(generated), {
      authData: { apiKey: 'k', baseUrl: server.url },
      inputData: { ...input, dry_run: true },
    });

    expect(generated).toEqual([]);
    expect(output.dry_run).toBe(true);
    expect(server.lastRequest()).toBe(null);
  });

  it('previews outside the calling window on a dry run, generating no callback url', async () => {
    server = await startFakeCalle({});
    const generated = [];
    vi.useFakeTimers({ toFake: ['Date'] });
    // 03:00 UTC is 22:00 EST the prior day - outside 8-21.
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 14, 3, 0, 0)));
    try {
      const output = await placeCallAndWait.operation.perform(zFor(generated), {
        authData: { apiKey: 'k', baseUrl: server.url },
        inputData: {
          ...input,
          dry_run: true,
          calling_window_timezone: 'America/New_York',
          calling_window_earliest_hour: 8,
          calling_window_latest_hour: 21,
        },
      });

      expect(generated).toEqual([]);
      expect(output.dry_run).toBe(true);
      expect(output.preview).toBeDefined();
      expect(output.calling_window.allowed).toBe(false);
      expect(server.lastRequest()).toBe(null);
    } finally {
      vi.useRealTimers();
    }
  });

  it('generates no callback url and makes no request for a suppressed number', async () => {
    server = await startFakeCalle({});
    const generated = [];
    const output = await placeCallAndWait.operation.perform(zFor(generated), {
      authData: { apiKey: 'k', baseUrl: server.url },
      inputData: { ...input, suppression_list: '+15550123456' },
    });

    expect(generated).toEqual([]);
    expect(output.disposition).toBe('suppressed');
    expect(output.is_actionable).toBe(false);
    expect(server.lastRequest()).toBe(null);
  });

  it('generates no callback url for a suppressed number even on a dry run', async () => {
    server = await startFakeCalle({});
    const generated = [];
    const output = await placeCallAndWait.operation.perform(zFor(generated), {
      authData: { apiKey: 'k', baseUrl: server.url },
      inputData: { ...input, dry_run: true, suppression_list: '+15550123456' },
    });

    expect(generated).toEqual([]);
    expect(output.dry_run).toBe(true);
    expect(output.disposition).toBe('suppressed');
    expect(server.lastRequest()).toBe(null);
  });

  it('generates no callback url and makes no request outside the calling window', async () => {
    server = await startFakeCalle({});
    const generated = [];
    vi.useFakeTimers({ toFake: ['Date'] });
    // 03:00 UTC is 22:00 EST the prior day - outside 8-21.
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 14, 3, 0, 0)));
    try {
      const output = await placeCallAndWait.operation.perform(zFor(generated), {
        authData: { apiKey: 'k', baseUrl: server.url },
        inputData: {
          ...input,
          calling_window_timezone: 'America/New_York',
          calling_window_earliest_hour: 8,
          calling_window_latest_hour: 21,
        },
      });

      expect(generated).toEqual([]);
      expect(output.disposition).toBe('outside_calling_window');
      expect(output.is_actionable).toBe(false);
      expect(server.lastRequest()).toBe(null);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('place-call-and-wait retry policy', () => {
  const hoursAgo = (hours) => new Date(Date.now() - hours * 3600000).toISOString();

  it('refuses to dial, and mints no callback url, when the retry policy blocks', async () => {
    server = await startFakeCalle({});
    const generated = [];
    const output = await placeCallAndWait.operation.perform(zFor(generated), {
      authData: { apiKey: 'k', baseUrl: server.url },
      inputData: { ...input, previous_attempts: [hoursAgo(20), hoursAgo(6)].join('\n') },
    });

    expect(output.disposition).toBe('retry_policy_blocked');
    expect(output.lead_state).toBe('blocked_compliance');
    expect(output.is_actionable).toBe(false);
    expect(output.call_id).toBeNull();
    // A callback url for a call that was never placed would strand the Zap
    // waiting for a webhook that can never arrive.
    expect(generated).toEqual([]);
    expect(server.lastRequest()).toBeNull();
  });

  it('dials, and waits, when the history is within the policy', async () => {
    server = await startFakeCalle({});
    const generated = [];
    const output = await placeCallAndWait.operation.perform(zFor(generated), {
      authData: { apiKey: 'k', baseUrl: server.url },
      inputData: { ...input, previous_attempts: hoursAgo(30) },
    });

    expect(output.call_id).toMatch(/^call_/);
    expect(generated).toEqual(['generated']);
  });
});

describe('place-call-and-wait performResume', () => {
  const record = {
    id: 'call_9',
    status: 'completed',
    task_completed: true,
    completion_confidence: { score: 0.95, label: 'high' },
    structured_result: { acknowledged: 'yes' },
    metadata: { correlation_id: 'incident-42' },
    recipients: [],
  };

  const completed = { id: 'evt_9', type: 'call.completed', data: { ...record } };

  // What CALL-E says when asked directly. The callback body never reaches the
  // classifier, so this - not the POSTed payload - decides every field.
  const zServing = (served = record, { throws = null, status = 200 } = {}) => ({
    request: async ({ url }) => {
      if (throws) throw new Error(throws);
      const id = decodeURIComponent(url.split('/').pop());
      if (!served || served.id !== id) return { status: 404, data: { error: { code: 'not_found' } } };
      return { status, data: served };
    },
  });

  const resumeBundle = (overrides = {}) => ({
    authData: { apiKey: 'k' },
    outputData: { call_id: 'call_9' },
    cleanedRequest: completed,
    ...overrides,
  });

  it('classifies the resumed event', async () => {
    const output = await placeCallAndWait.operation.performResume(zServing(), resumeBundle());
    expect(output.disposition).toBe('confirmed');
    expect(output.result_acknowledged).toBe('yes');
    expect(output.correlation_id).toBe('incident-42');
    expect(output.verified).toBe(true);
  });

  // The callback URL is unauthenticated and the call id travels inside the
  // same untrusted body, so id-matching alone lets anyone who learns the URL
  // and the id write a clean success into a CRM. The body is a notification;
  // the record CALL-E returns is the answer.
  it('classifies what CALL-E reports, not what the callback body claims', async () => {
    const forged = {
      id: 'evt_forged',
      type: 'call.completed',
      data: {
        id: 'call_9',
        status: 'completed',
        task_completed: true,
        completion_confidence: { score: 1, label: 'high' },
        structured_result: { acknowledged: 'yes' },
        recipients: [],
      },
    };
    // CALL-E's own record of call_9: the recipient never answered the question.
    const truth = { ...record, structured_result: { acknowledged: 'unknown' } };

    const output = await placeCallAndWait.operation.performResume(
      zServing(truth),
      resumeBundle({ cleanedRequest: forged }),
    );

    expect(output.disposition).toBe('review_required');
    expect(output.is_actionable).toBe(false);
    expect(output.result_acknowledged).toBe('unknown');
  });

  it('fails closed when CALL-E cannot be reached to confirm the outcome', async () => {
    const output = await placeCallAndWait.operation.performResume(
      zServing(record, { throws: 'socket hang up' }),
      resumeBundle(),
    );

    expect(output.disposition).toBe('needs_human');
    expect(output.is_actionable).toBe(false);
    expect(output.verified).toBe(false);
    expect(output.disposition_reason).toMatch(/could not be confirmed/i);
  });

  it('fails closed when CALL-E has no record of the call the callback named', async () => {
    const output = await placeCallAndWait.operation.performResume(zServing(null), resumeBundle());
    expect(output.disposition).toBe('needs_human');
    expect(output.is_actionable).toBe(false);
    expect(output.verified).toBe(false);
  });

  // This action is the only surface that knows the contract the call was
  // placed under, so it is the only one that can catch a result missing a
  // field the caller declared required.
  it('holds the result to the result_schema the call was placed with', async () => {
    const output = await placeCallAndWait.operation.performResume(
      zServing(),
      resumeBundle({
        inputData: {
          result_schema: JSON.stringify({
            type: 'object',
            required: ['acknowledged', 'eta_minutes'],
            properties: { acknowledged: { type: 'string' }, eta_minutes: { type: 'integer' } },
          }),
        },
      }),
    );

    expect(output.disposition).toBe('review_required');
    expect(output.lead_state).toBe('needs_human');
    expect(output.disposition_reason).toContain('eta_minutes');
  });

  it('honors a caller-supplied confidence floor on resume', async () => {
    const output = await placeCallAndWait.operation.performResume(
      zServing(),
      resumeBundle({ inputData: { min_confidence_score: '0.99' } }),
    );
    expect(output.disposition).toBe('review_required');
    expect(output.disposition_reason).toContain('0.95');
  });

  it('marks a confirmed resume as qualified for coarse branching', async () => {
    const output = await placeCallAndWait.operation.performResume(zServing(), resumeBundle());
    expect(output.lead_state).toBe('qualified');
  });

  it('returns outcome_unknown when the callback body is empty', async () => {
    const output = await placeCallAndWait.operation.performResume(
      zServing(),
      resumeBundle({ cleanedRequest: null }),
    );
    expect(output.disposition).toBe('outcome_unknown');
  });

  it('fails closed when the resumed event is for a different call', async () => {
    const output = await placeCallAndWait.operation.performResume(
      zServing(),
      resumeBundle({ outputData: { call_id: 'call_OTHER' } }),
    );
    expect(output.disposition).toBe('needs_human');
    expect(output.disposition_reason).toMatch(/different call/i);
  });

  it('fails closed when the started call id is unknown', async () => {
    const output = await placeCallAndWait.operation.performResume(
      zServing(),
      resumeBundle({ outputData: {} }),
    );
    expect(output.disposition).toBe('needs_human');
    expect(output.is_actionable).toBe(false);
  });

  it('fails closed when the callback carries no call id', async () => {
    const output = await placeCallAndWait.operation.performResume(
      zServing(),
      resumeBundle({ cleanedRequest: { ...completed, data: { ...completed.data, id: undefined } } }),
    );
    expect(output.disposition).toBe('needs_human');
    expect(output.is_actionable).toBe(false);
  });

  it('makes no lookup at all for a callback that fails the id checks', async () => {
    const seen = [];
    const z = { request: async (options) => { seen.push(options); return { status: 200, data: record }; } };
    await placeCallAndWait.operation.performResume(z, resumeBundle({ outputData: { call_id: 'call_OTHER' } }));
    expect(seen).toEqual([]);
  });

  it('still classifies normally when the ids match', async () => {
    const output = await placeCallAndWait.operation.performResume(zServing(), resumeBundle());
    expect(output.disposition).toBe('confirmed');
    expect(output.is_actionable).toBe(true);
  });
});
