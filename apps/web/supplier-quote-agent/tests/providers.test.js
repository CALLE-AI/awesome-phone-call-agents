const { FakeCallProvider } = require('../src/providers/fake-call-provider');
const { CallEProvider, parseCallEResponse } = require('../src/providers/calle-provider');
const { getProvider } = require('../src/providers');
const fixtures = require('./fixtures/calle-responses.json');

describe('FakeCallProvider', () => {
  test('emits dialing -> connected -> wrapping_up -> done on a controllable clock', async () => {
    const seen = [];
    let tick = 0;
    const provider = new FakeCallProvider({ clock: () => `t${tick++}` });

    const outcome = await provider.placeCall(
      { id: 'task_x' },
      { onStatusChange: (status, at) => seen.push([status, at]) }
    );

    expect(seen.map((s) => s[0])).toEqual(['dialing', 'connected', 'wrapping_up', 'done']);
    expect(seen.map((s) => s[1])).toEqual(['t0', 't1', 't2', 't3']);
    expect(outcome).toEqual(
      expect.objectContaining({
        outcome: expect.any(String),
        summary: expect.any(String),
        next_action: expect.any(String)
      })
    );
  });

  test('honours an abort signal and never reaches done', async () => {
    const controller = new AbortController();
    const seen = [];
    const provider = new FakeCallProvider({
      wait: () => {
        if (seen.length === 1) {
          controller.abort();
        }
        return Promise.resolve();
      }
    });

    await expect(
      provider.placeCall(
        { id: 'task_x' },
        { onStatusChange: (status) => seen.push(status), signal: controller.signal }
      )
    ).rejects.toThrow(/abort/i);

    expect(seen).not.toContain('done');
  });

  test('rejects an unknown scenario before dialing', async () => {
    const provider = new FakeCallProvider();
    await expect(provider.placeCall({}, { scenario: 'nonexistent' })).rejects.toThrow(
      /no canned response/i
    );
  });

  test('picks canned responses by scenario', async () => {
    const provider = new FakeCallProvider();
    const outcome = await provider.placeCall({}, { scenario: 'no_answer' });
    expect(outcome.outcome).toBe('no_answer');
  });
});

describe('CallEProvider (fixtures only — never dials)', () => {
  const task = {
    id: 'task_x',
    sku: 'WIDGET-42',
    quantity: 100,
    suppliers: [{ name: 'Acme', phone: '+1-555-0100' }],
    plan: { goal: 'get a quote' }
  };

  test('parseCallEResponse maps a successful fixture', () => {
    expect(parseCallEResponse(fixtures.success)).toEqual({
      outcome: 'quoted',
      summary: fixtures.success.structured_result.summary,
      next_action: 'review_quote'
    });
  });

  test('parseCallEResponse maps a failure fixture', () => {
    expect(parseCallEResponse(fixtures.failure)).toEqual({
      outcome: 'failed',
      summary: fixtures.failure.structured_result.summary,
      next_action: 'retry_call'
    });
  });

  test('parseCallEResponse falls back when a failed call carries no structured result', () => {
    expect(parseCallEResponse(fixtures.no_structured_result)).toEqual({
      outcome: 'failed',
      summary: 'Call failed; no outcome recorded.',
      next_action: 'retry_call'
    });
  });

  // A call that actually happened must never come back asking to be retried — that is
  // the one fallback that would put a second real call behind a single approval.
  test('parseCallEResponse does not ask to retry a completed call with no extraction', () => {
    expect(parseCallEResponse(fixtures.completed_no_structured_result)).toEqual({
      outcome: 'failed',
      summary: 'Call completed but CALL-E could not extract a schema-valid result from it.',
      next_action: 'no_action'
    });
  });

  test('placeCall creates the call, polls the real REST API, and parses the terminal response', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, opts });
      if (calls.length === 1) {
        return { ok: true, json: async () => ({ id: 'call_success_1', status: 'queued' }) };
      }
      return { ok: true, json: async () => fixtures.success };
    };
    const provider = new CallEProvider({ apiKey: 'test-key', fetchImpl, pollIntervalMs: 0 });

    const outcome = await provider.placeCall(task, {});

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('https://api.heycall-e.com/v1/calls');
    expect(calls[0].opts.method).toBe('POST');
    expect(calls[0].opts.headers.Authorization).toBe('Bearer test-key');
    // Sent E.164-normalized (no dashes) — the actual format CALL-E's API requires.
    expect(JSON.parse(calls[0].opts.body).recipients).toEqual([{ phones: ['+15550100'] }]);
    expect(calls[1].url).toBe('https://api.heycall-e.com/v1/calls/call_success_1');
    expect(calls[1].opts.headers.Authorization).toBe('Bearer test-key');
    expect(outcome).toEqual({
      outcome: 'quoted',
      summary: fixtures.success.structured_result.summary,
      next_action: 'review_quote'
    });
  });

  test('placeCall polls through non-terminal statuses before resolving', async () => {
    const statuses = ['queued', 'in_progress', 'in_progress', 'completed'];
    let pollIndex = 0;
    const seen = [];
    const fetchImpl = async (url, opts) => {
      if (opts.method === 'POST') {
        return { ok: true, json: async () => ({ id: 'call_success_1', status: 'queued' }) };
      }
      const status = statuses[pollIndex++];
      return {
        ok: true,
        json: async () => (status === 'completed' ? fixtures.success : { id: 'call_success_1', status })
      };
    };
    const provider = new CallEProvider({ apiKey: 'test-key', fetchImpl, pollIntervalMs: 0 });

    const outcome = await provider.placeCall(task, { onStatusChange: (s) => seen.push(s) });

    expect(pollIndex).toBe(statuses.length);
    expect(seen).toEqual(['dialing', 'connected', 'done']);
    expect(outcome.outcome).toBe('quoted');
  });

  test('parseCallEResponse does not report a business outcome for a non-completed call', () => {
    const canceledWithResult = {
      status: 'canceled',
      structured_result: { outcome: 'quoted', summary: 'partial', next_action: 'review_quote' }
    };
    expect(parseCallEResponse(canceledWithResult)).toEqual({
      outcome: 'failed',
      summary: 'partial',
      next_action: 'retry_call'
    });
  });

  test('placeCall aborts between polls rather than waiting out the interval', async () => {
    const controller = new AbortController();
    let polls = 0;
    const fetchImpl = async (url, opts) => {
      if (opts.method === 'POST') {
        return { ok: true, json: async () => ({ id: 'call_success_1', status: 'queued' }) };
      }
      polls += 1;
      controller.abort();
      return { ok: true, json: async () => ({ id: 'call_success_1', status: 'in_progress' }) };
    };
    const provider = new CallEProvider({
      apiKey: 'test-key',
      fetchImpl,
      pollIntervalMs: 60000,
      pollTimeoutMs: 120000
    });

    await expect(provider.placeCall(task, { signal: controller.signal })).rejects.toThrow(/abort/i);
    expect(polls).toBe(1);
  });

  test('placeCall surfaces a create response with no id instead of polling undefined', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ call_id: 'wrong_key' }) });
    const provider = new CallEProvider({ apiKey: 'test-key', fetchImpl, pollIntervalMs: 0 });
    await expect(provider.placeCall(task, {})).rejects.toThrow(/no "id" to poll.*call_id/s);
  });

  test('the idempotency key is stable for one approval and changes with the next', async () => {
    const keys = [];
    const fetchImpl = async (url, opts) => {
      if (opts.method === 'POST') {
        keys.push(opts.headers['Idempotency-Key']);
        return { ok: true, json: async () => ({ id: 'call_success_1', status: 'queued' }) };
      }
      return { ok: true, json: async () => fixtures.success };
    };
    const provider = new CallEProvider({ apiKey: 'test-key', fetchImpl, pollIntervalMs: 0 });
    const approved = { ...task, approvedAt: '2026-09-13T10:00:00.000Z' };
    const reapproved = { ...task, approvedAt: '2026-09-13T11:00:00.000Z' };

    await provider.placeCall(approved, {});
    await provider.placeCall(approved, {});
    await provider.placeCall(reapproved, {});

    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  test('placeCall throws on a non-ok create response, never falling back to a fake outcome', async () => {
    const fetchImpl = async () => ({ ok: false, status: 500 });
    const provider = new CallEProvider({ apiKey: 'test-key', fetchImpl });
    await expect(provider.placeCall(task, {})).rejects.toThrow(/500/);
  });

  test('placeCall throws when the task has no supplier', async () => {
    const fetchImpl = async () => {
      throw new Error('fetchImpl should never be called for a task with no supplier');
    };
    const provider = new CallEProvider({ apiKey: 'test-key', fetchImpl });
    await expect(provider.placeCall({ id: 'task_x' }, {})).rejects.toThrow(/no supplier/i);
  });

  test('refuses to dial without an API key', async () => {
    const fetchImpl = async () => {
      throw new Error('fetchImpl should never be called without an API key');
    };
    const provider = new CallEProvider({ apiKey: undefined, fetchImpl });
    await expect(provider.placeCall(task, {})).rejects.toThrow(/CALLE_API_KEY/);
  });

  test('refuses to construct against a non-https base URL, before any credential is ever sent', () => {
    expect(() => new CallEProvider({ apiKey: 'test-key', baseUrl: 'http://api.heycall-e.com' })).toThrow(
      /https/i
    );
  });

  test('reports cancellation as non-authoritative — the Calls API has no client cancel operation', () => {
    const provider = new CallEProvider({ apiKey: 'test-key' });
    expect(provider.cancelIsAuthoritative).toBe(false);
  });

  test('normalizes a punctuated phone to strict E.164 before dialing', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, opts });
      if (opts.method === 'POST') {
        return { ok: true, json: async () => ({ id: 'call_1', status: 'queued' }) };
      }
      return { ok: true, json: async () => fixtures.success };
    };
    const provider = new CallEProvider({ apiKey: 'test-key', fetchImpl, pollIntervalMs: 0 });
    const punctuated = { ...task, suppliers: [{ name: 'Acme', phone: '+1 (555) 010-0' }] };

    await provider.placeCall(punctuated, {});

    expect(JSON.parse(calls[0].opts.body).recipients).toEqual([{ phones: ['+15550100'] }]);
  });

  test('refuses to dial a non-ASCII phone number', async () => {
    const fetchImpl = async () => {
      throw new Error('fetchImpl should never be called for an invalid phone');
    };
    const provider = new CallEProvider({ apiKey: 'test-key', fetchImpl });
    const badTask = { ...task, suppliers: [{ name: 'Acme', phone: '+1５５５0100' }] };
    await expect(provider.placeCall(badTask, {})).rejects.toThrow(/non-ASCII/i);
  });

  test('refuses to dial a malformed phone number', async () => {
    const fetchImpl = async () => {
      throw new Error('fetchImpl should never be called for an invalid phone');
    };
    const provider = new CallEProvider({ apiKey: 'test-key', fetchImpl });
    const badTask = { ...task, suppliers: [{ name: 'Acme', phone: 'not-a-phone-number' }] };
    await expect(provider.placeCall(badTask, {})).rejects.toThrow(/not a valid E\.164/i);
  });
});

describe('FakeCallProvider.cancelIsAuthoritative', () => {
  test('defaults to true — a fake abort genuinely ends the sequence', () => {
    expect(new FakeCallProvider().cancelIsAuthoritative).toBe(true);
  });

  test('is overridable for tests that need to simulate a real-provider-style cancel', () => {
    expect(new FakeCallProvider({ cancelIsAuthoritative: false }).cancelIsAuthoritative).toBe(false);
  });
});

describe('getProvider', () => {
  test('defaults to the fake provider', () => {
    expect(getProvider()).toBeInstanceOf(FakeCallProvider);
  });

  test('returns the CallEProvider by name', () => {
    expect(getProvider('calle')).toBeInstanceOf(CallEProvider);
  });

  test('throws on an unknown provider name', () => {
    expect(() => getProvider('bogus')).toThrow(/unknown call provider/i);
  });
});
