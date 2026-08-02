import { describe, it, expect, afterEach } from 'vitest';
import { startFakeCalle } from './fake-calle-server.js';
import findCallResult from '../searches/find-call-result.js';

let server;
afterEach(async () => {
  if (server) await server.close();
  server = null;
});

const z = {
  request: async (options) => {
    const response = await fetch(options.url, {
      headers: { authorization: 'Bearer k' },
    });
    return { status: response.status, data: await response.json() };
  },
};

describe('find-call-result', () => {
  it('returns a single flattened result for a known call', async () => {
    server = await startFakeCalle({});
    const created = await fetch(`${server.url}/v1/calls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer k' },
      body: JSON.stringify({ task: 'Call +15550123456.' }),
    }).then((r) => r.json());

    server.setStatus(created.id, {
      status: 'completed',
      task_completed: true,
      completion_confidence: { score: 0.9, label: 'high' },
      structured_result: { acknowledged: 'yes' },
    });

    const results = await findCallResult.operation.perform(z, {
      authData: { apiKey: 'k', baseUrl: server.url },
      inputData: { call_id: created.id },
    });

    expect(results).toHaveLength(1);
    expect(results[0].disposition).toBe('confirmed');
    expect(results[0].call_id).toBe(created.id);
  });

  it('reports a still-running call as outcome_unknown rather than failed', async () => {
    server = await startFakeCalle({});
    const created = await fetch(`${server.url}/v1/calls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer k' },
      body: JSON.stringify({ task: 'Call +15550123456.' }),
    }).then((r) => r.json());

    server.setStatus(created.id, { status: 'in_progress' });

    const results = await findCallResult.operation.perform(z, {
      authData: { apiKey: 'k', baseUrl: server.url },
      inputData: { call_id: created.id },
    });

    expect(results[0].disposition).toBe('outcome_unknown');
  });

  it('requires a call id', async () => {
    server = await startFakeCalle({});
    await expect(
      findCallResult.operation.perform(z, {
        authData: { apiKey: 'k', baseUrl: server.url },
        inputData: {},
      }),
    ).rejects.toThrow(/call id/i);
  });
});
