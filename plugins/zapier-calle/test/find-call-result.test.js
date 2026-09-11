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

  // Zapier holds a waiting callback step for up to 30 days and offers no
  // timeout hook, so "Place Call and Wait" cannot time itself out. Pairing a
  // Delay step with this search is the only way to bound the wait, and that
  // only works if the search can tell a stalled call from a running one.
  describe('reconciliation limit', () => {
    const stalledCall = async (createdAt) => {
      server = await startFakeCalle({});
      const created = await fetch(`${server.url}/v1/calls`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer k' },
        body: JSON.stringify({ task: 'Call +15550123456.' }),
      }).then((r) => r.json());
      server.setStatus(created.id, { status: 'in_progress', created_at: createdAt });
      return created.id;
    };

    const lookup = (callId, inputData) =>
      findCallResult.operation.perform(z, {
        authData: { apiKey: 'k', baseUrl: server.url },
        inputData: { call_id: callId, ...inputData },
      });

    const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();

    it('escalates a call still running past the limit to needs_human', async () => {
      const callId = await stalledCall(minutesAgo(45));
      const [result] = await lookup(callId, { max_wait_minutes: 10 });

      expect(result.disposition).toBe('needs_human');
      expect(result.is_actionable).toBe(false);
      expect(result.lead_state).toBe('needs_human');
      expect(result.reconciliation_timed_out).toBe(true);
      expect(result.disposition_reason).toContain('10 minute');
    });

    it('leaves a call still inside the limit as outcome_unknown', async () => {
      const callId = await stalledCall(minutesAgo(3));
      const [result] = await lookup(callId, { max_wait_minutes: 10 });

      expect(result.disposition).toBe('outcome_unknown');
      expect(result.reconciliation_timed_out).toBe(false);
    });

    it('does nothing when no limit was set', async () => {
      const callId = await stalledCall(minutesAgo(600));
      const [result] = await lookup(callId, {});

      expect(result.disposition).toBe('outcome_unknown');
      expect(result.reconciliation_timed_out).toBe(false);
    });

    it('ignores the limit for a call that already reached a terminal state', async () => {
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
        created_at: minutesAgo(600),
      });

      const [result] = await lookup(created.id, { max_wait_minutes: 10 });
      expect(result.disposition).toBe('confirmed');
      expect(result.reconciliation_timed_out).toBe(false);
    });

    // Fail closed: a call whose age cannot be established is not evidence
    // that it is healthy.
    it('escalates when the call age cannot be read', async () => {
      const callId = await stalledCall('not a date');
      const [result] = await lookup(callId, { max_wait_minutes: 10 });
      expect(result.disposition).toBe('needs_human');
      expect(result.disposition_reason).toContain('age is unknown');
    });

    it('ignores an unusable limit rather than escalating every call', async () => {
      const callId = await stalledCall(minutesAgo(600));
      for (const value of ['abc', -5, 0, [], {}]) {
        const [result] = await lookup(callId, { max_wait_minutes: value });
        expect(result.reconciliation_timed_out, String(value)).toBe(false);
      }
    });
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
