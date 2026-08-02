import { describe, it, expect, afterEach } from 'vitest';
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
