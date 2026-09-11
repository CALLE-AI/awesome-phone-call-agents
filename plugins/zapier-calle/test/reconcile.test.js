import { describe, it, expect } from 'vitest';
import { fetchAuthoritativeCall, syntheticEvent } from '../lib/reconcile.js';

const bundle = { authData: { apiKey: 'k', baseUrl: 'https://example.invalid' } };

const zServing = (status, data, seen = []) => ({
  request: async (options) => {
    seen.push(options);
    return { status, data };
  },
});

describe('fetchAuthoritativeCall', () => {
  it('returns the record when CALL-E confirms the call id', async () => {
    const seen = [];
    const result = await fetchAuthoritativeCall(
      zServing(200, { id: 'call_9', status: 'completed' }, seen),
      bundle,
      'call_9',
    );

    expect(result.ok).toBe(true);
    expect(result.data.status).toBe('completed');
    expect(seen[0].url).toBe('https://example.invalid/v1/calls/call_9');
    // The status has to be inspected here rather than thrown on, so a 404 can
    // be told apart from a transient outage.
    expect(seen[0].skipThrowForStatus).toBe(true);
  });

  it('reports notFound for a call this connection cannot see', async () => {
    const result = await fetchAuthoritativeCall(
      zServing(404, { error: { code: 'not_found' } }),
      bundle,
      'call_forged',
    );

    expect(result.ok).toBe(false);
    expect(result.notFound).toBe(true);
  });

  it('fails closed, and not as notFound, when CALL-E cannot be reached', async () => {
    const z = { request: async () => { throw new Error('socket hang up'); } };
    const result = await fetchAuthoritativeCall(z, bundle, 'call_9');

    expect(result.ok).toBe(false);
    expect(result.notFound).toBe(false);
    expect(result.reason).toMatch(/could not be reached|socket hang up/i);
  });

  it('fails closed when CALL-E returns a record for a different call', async () => {
    const result = await fetchAuthoritativeCall(
      zServing(200, { id: 'call_OTHER', status: 'completed' }),
      bundle,
      'call_9',
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/different call/i);
  });

  it('fails closed when the response body is not a readable record', async () => {
    for (const body of [null, undefined, 'nope', 42, []]) {
      const result = await fetchAuthoritativeCall(zServing(200, body), bundle, 'call_9');
      expect(result.ok).toBe(false);
    }
  });

  it('fails closed on a server error rather than treating it as an absent call', async () => {
    const result = await fetchAuthoritativeCall(zServing(503, {}), bundle, 'call_9');
    expect(result.ok).toBe(false);
    expect(result.notFound).toBe(false);
  });

  it('fails closed without making a request when there is no usable call id', async () => {
    const seen = [];
    for (const id of [undefined, null, '', '   ', 42, {}]) {
      const result = await fetchAuthoritativeCall(zServing(200, {}, seen), bundle, id);
      expect(result.ok).toBe(false);
    }
    expect(seen).toEqual([]);
  });

  it('fails closed when no client is available to confirm with', async () => {
    const result = await fetchAuthoritativeCall(null, bundle, 'call_9');
    expect(result.ok).toBe(false);
  });
});

describe('syntheticEvent', () => {
  it('derives the event type from the record status when none is supplied', () => {
    expect(syntheticEvent({ id: 'call_9', status: 'failed' }).type).toBe('call.failed');
    expect(syntheticEvent({ id: 'call_9', status: 'completed' }).type).toBe('call.completed');
  });

  // A caller-supplied type can only steer the classifier toward a *less*
  // actionable answer - the data it classifies is the authoritative record -
  // so passing it through keeps an unrecognized event type failing closed.
  it('keeps a supplied event type, including an unrecognized one', () => {
    const event = syntheticEvent({ id: 'call_9', status: 'completed' }, { id: 'evt_1', type: 'call.something_new' });
    expect(event.type).toBe('call.something_new');
    expect(event.id).toBe('evt_1');
  });

  it('carries the record through as the event data', () => {
    const data = { id: 'call_9', status: 'completed', completed_at: '2026-08-02T00:01:00Z' };
    const event = syntheticEvent(data);
    expect(event.data).toBe(data);
    expect(event.created_at).toBe('2026-08-02T00:01:00Z');
  });
});
