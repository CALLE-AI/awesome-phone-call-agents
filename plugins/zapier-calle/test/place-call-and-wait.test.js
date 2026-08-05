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

const input = { task: 'Call the on-call engineer.', phone: '+15550123456' };

describe('place-call-and-wait perform', () => {
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
  const completed = {
    id: 'evt_9',
    type: 'call.completed',
    data: {
      id: 'call_9',
      status: 'completed',
      task_completed: true,
      completion_confidence: { score: 0.95, label: 'high' },
      structured_result: { acknowledged: 'yes' },
      metadata: { correlation_id: 'incident-42' },
      recipients: [],
    },
  };

  it('classifies the resumed event', async () => {
    const output = await placeCallAndWait.operation.performResume(null, {
      outputData: { call_id: 'call_9' },
      cleanedRequest: completed,
    });
    expect(output.disposition).toBe('confirmed');
    expect(output.result_acknowledged).toBe('yes');
    expect(output.correlation_id).toBe('incident-42');
  });

  // This action is the only surface that knows the contract the call was
  // placed under, so it is the only one that can catch a result missing a
  // field the caller declared required.
  it('holds the result to the result_schema the call was placed with', async () => {
    const output = await placeCallAndWait.operation.performResume(null, {
      outputData: { call_id: 'call_9' },
      inputData: {
        result_schema: JSON.stringify({
          type: 'object',
          required: ['acknowledged', 'eta_minutes'],
          properties: { acknowledged: { type: 'string' }, eta_minutes: { type: 'integer' } },
        }),
      },
      cleanedRequest: completed,
    });

    expect(output.disposition).toBe('review_required');
    expect(output.lead_state).toBe('needs_human');
    expect(output.disposition_reason).toContain('eta_minutes');
  });

  it('honors a caller-supplied confidence floor on resume', async () => {
    const output = await placeCallAndWait.operation.performResume(null, {
      outputData: { call_id: 'call_9' },
      inputData: { min_confidence_score: '0.99' },
      cleanedRequest: completed,
    });
    expect(output.disposition).toBe('review_required');
    expect(output.disposition_reason).toContain('0.95');
  });

  it('marks a confirmed resume as qualified for coarse branching', async () => {
    const output = await placeCallAndWait.operation.performResume(null, {
      outputData: { call_id: 'call_9' },
      cleanedRequest: completed,
    });
    expect(output.lead_state).toBe('qualified');
  });

  it('returns outcome_unknown when the callback body is empty', async () => {
    const output = await placeCallAndWait.operation.performResume(null, {
      outputData: { call_id: 'call_9' },
      cleanedRequest: null,
    });
    expect(output.disposition).toBe('outcome_unknown');
  });

  it('fails closed when the resumed event is for a different call', async () => {
    const output = await placeCallAndWait.operation.performResume(null, {
      outputData: { call_id: 'call_OTHER' },
      cleanedRequest: completed,
    });
    expect(output.disposition).toBe('needs_human');
    expect(output.disposition_reason).toMatch(/different call/i);
  });

  it('fails closed when the started call id is unknown', async () => {
    const output = await placeCallAndWait.operation.performResume(null, {
      outputData: {},
      cleanedRequest: completed,
    });
    expect(output.disposition).toBe('needs_human');
    expect(output.is_actionable).toBe(false);
  });

  it('fails closed when the callback carries no call id', async () => {
    const output = await placeCallAndWait.operation.performResume(null, {
      outputData: { call_id: 'call_9' },
      cleanedRequest: { ...completed, data: { ...completed.data, id: undefined } },
    });
    expect(output.disposition).toBe('needs_human');
    expect(output.is_actionable).toBe(false);
  });

  it('still classifies normally when the ids match', async () => {
    const output = await placeCallAndWait.operation.performResume(null, {
      outputData: { call_id: 'call_9' },
      cleanedRequest: completed,
    });
    expect(output.disposition).toBe('confirmed');
    expect(output.is_actionable).toBe(true);
  });
});
