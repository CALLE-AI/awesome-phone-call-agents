const http = require('http');
const { FakeCallProvider } = require('../src/providers/fake-call-provider');
const {
  CallEProvider,
  parseCallEResponse,
  parseAllowlistEnv
} = require('../src/providers/calle-provider');
const { getProvider } = require('../src/providers');
const { isFictionalNumber } = require('../src/fictional-numbers');
const { scan } = require('./helpers/repo-numbers');
const { maskPhone } = require('../src/mask');
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

// The accept path needs a destination the provider will dial, and this repo holds no real
// phone number to use as one. FIXTURE is Ofcom's London drama range — never allocated to a
// line — accepted here only through the constructor-only `isFictionalDestination` option,
// which invoke.js never passes. Every other fictional number stays refused.
const FIXTURE = '+442079460958';
const acceptFixtureOnly = (n) => n !== FIXTURE && isFictionalNumber(n);

const task = {
  id: 'task_x',
  sku: 'WIDGET-42',
  quantity: 100,
  suppliers: [{ name: 'Acme', phone: '+44 20 7946 0958' }],
  plan: { goal: 'get a quote' }
};

function makeProvider(overrides = {}) {
  return new CallEProvider({
    apiKey: 'test-key',
    allowedDestinations: [FIXTURE],
    isFictionalDestination: acceptFixtureOnly,
    pollIntervalMs: 0,
    ...overrides
  });
}

const neverFetch = async () => {
  throw new Error('fetchImpl must never be called on this path');
};

function recordingFetch(createBody = { id: 'call_success_1', status: 'queued' }) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (opts.method === 'POST') {
      return { ok: true, json: async () => createBody };
    }
    return { ok: true, json: async () => fixtures.success };
  };
  return { calls, fetchImpl };
}

describe('CallEProvider (fixtures only — never dials)', () => {
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

  test('placeCall creates the call, polls the real REST API, and parses the terminal response', async () => {
    const { calls, fetchImpl } = recordingFetch();
    const provider = makeProvider({ fetchImpl });

    const outcome = await provider.placeCall(task, {});

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('https://api.heycall-e.com/v1/calls');
    expect(calls[0].opts.method).toBe('POST');
    expect(calls[0].opts.headers.Authorization).toBe('Bearer test-key');
    // Sent E.164-normalized (no spaces) — the actual format CALL-E's API requires.
    expect(JSON.parse(calls[0].opts.body).recipients).toEqual([{ phones: [FIXTURE] }]);
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
    const provider = makeProvider({ fetchImpl });

    const outcome = await provider.placeCall(task, { onStatusChange: (s) => seen.push(s) });

    expect(pollIndex).toBe(statuses.length);
    expect(seen).toEqual(['dialing', 'connected', 'done']);
    expect(outcome.outcome).toBe('quoted');
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
    const provider = makeProvider({ fetchImpl, pollIntervalMs: 60000, pollTimeoutMs: 120000 });

    await expect(provider.placeCall(task, { signal: controller.signal })).rejects.toThrow(/abort/i);
    expect(polls).toBe(1);
  });

  test('placeCall surfaces a create response with no id instead of polling undefined', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ call_id: 'wrong_key' }) });
    const provider = makeProvider({ fetchImpl });
    await expect(provider.placeCall(task, {})).rejects.toThrow(/no "id" to poll.*call_id/s);
  });

  test('the idempotency key is stable for one approval and changes with the next', async () => {
    const { calls, fetchImpl } = recordingFetch();
    const provider = makeProvider({ fetchImpl });
    const approved = { ...task, approvedAt: '2026-09-13T10:00:00.000Z' };
    const reapproved = { ...task, approvedAt: '2026-09-13T11:00:00.000Z' };

    await provider.placeCall(approved, {});
    await provider.placeCall(approved, {});
    await provider.placeCall(reapproved, {});

    const keys = calls.filter((c) => c.opts.method === 'POST').map((c) => c.opts.headers['Idempotency-Key']);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  test('placeCall throws on a non-ok create response, never falling back to a fake outcome', async () => {
    const fetchImpl = async () => ({ ok: false, status: 500 });
    const provider = makeProvider({ fetchImpl });
    await expect(provider.placeCall(task, {})).rejects.toThrow(/500/);
  });

  test('placeCall throws when the task has no supplier', async () => {
    const provider = makeProvider({ fetchImpl: neverFetch });
    await expect(provider.placeCall({ id: 'task_x' }, {})).rejects.toThrow(/no supplier/i);
  });

  test('refuses to dial without an API key', async () => {
    const provider = makeProvider({ apiKey: undefined, fetchImpl: neverFetch });
    await expect(provider.placeCall(task, {})).rejects.toThrow(/CALLE_API_KEY/);
  });

  test('reports cancellation as non-authoritative — the Calls API has no client cancel operation', () => {
    expect(makeProvider().cancelIsAuthoritative).toBe(false);
  });

  test('normalizes a punctuated phone to strict E.164 before dialing', async () => {
    const { calls, fetchImpl } = recordingFetch();
    const provider = makeProvider({ fetchImpl });
    const punctuated = { ...task, suppliers: [{ name: 'Acme', phone: '+44 (20) 7946-0958' }] };

    await provider.placeCall(punctuated, {});

    expect(JSON.parse(calls[0].opts.body).recipients).toEqual([{ phones: [FIXTURE] }]);
  });

  test('refuses to dial a non-ASCII phone number', async () => {
    const provider = makeProvider({ fetchImpl: neverFetch });
    const badTask = { ...task, suppliers: [{ name: 'Acme', phone: '+44２０79460958' }] };
    await expect(provider.placeCall(badTask, {})).rejects.toThrow(/non-ASCII/i);
  });

  test('refuses to dial a malformed phone number', async () => {
    const provider = makeProvider({ fetchImpl: neverFetch });
    const badTask = { ...task, suppliers: [{ name: 'Acme', phone: 'not-a-phone-number' }] };
    await expect(provider.placeCall(badTask, {})).rejects.toThrow(/not a valid E\.164/i);
  });
});

// #524 item 1: "Pin the parsed approved HTTPS credential origin and reject redirects."
describe('CallEProvider — the API key only ever reaches the pinned origin', () => {
  test.each([
    ['plain http', 'http://api.heycall-e.com'],
    ['another host', 'https://attacker.example'],
    ['a look-alike suffix', 'https://api.heycall-e.com.evil.example'],
    ['userinfo', 'https://user:hunter2@api.heycall-e.com'],
    ['another port', 'https://api.heycall-e.com:8443'],
    ['a path', 'https://api.heycall-e.com/v2'],
    ['a query', 'https://api.heycall-e.com/?next=https://attacker.example'],
    ['no scheme at all', 'heycall-e api host']
  ])('refuses a base URL with %s, without echoing it', (_label, baseUrl) => {
    let error;
    try {
      makeProvider({ baseUrl, fetchImpl: neverFetch });
    } catch (err) {
      error = err;
    }
    expect(error).toBeDefined();
    expect(error.message).toMatch(/CALLE_BASE_URL/);
    expect(error.message).not.toContain(baseUrl);
    expect(error.message).not.toMatch(/hunter2|attacker|evil|8443|v2/);
  });

  test.each(['https://api.heycall-e.com', 'https://api.heycall-e.com/', 'HTTPS://API.HEYCALL-E.COM'])(
    'accepts the approved origin written as %s',
    (baseUrl) => {
      expect(makeProvider({ baseUrl }).origin).toBe('https://api.heycall-e.com');
    }
  );

  test('every request refuses redirects', async () => {
    const { calls, fetchImpl } = recordingFetch();
    await makeProvider({ fetchImpl }).placeCall(task, {});
    expect(calls).toHaveLength(2);
    calls.forEach((c) => expect(c.opts.redirect).toBe('error'));
  });

  test('a response that reports it was redirected is refused before it is read', async () => {
    let polls = 0;
    const fetchImpl = async (url, opts) => {
      if (opts.method !== 'POST') {
        polls += 1;
      }
      return { ok: true, redirected: true, url: 'https://api.heycall-e.com/v1/calls', json: async () => ({ id: 'call_1' }) };
    };
    await expect(makeProvider({ fetchImpl }).placeCall(task, {})).rejects.toThrow(/redirected; refusing/);
    expect(polls).toBe(0);
  });

  test('a response from any other origin is refused', async () => {
    const fetchImpl = async () => ({ ok: true, url: 'https://attacker.example/v1/calls', json: async () => ({ id: 'call_1' }) });
    await expect(makeProvider({ fetchImpl }).placeCall(task, {})).rejects.toThrow(/origin other than the pinned/);
  });

  test('a response from the pinned origin is accepted', async () => {
    const fetchImpl = async (url, opts) => ({
      ok: true,
      redirected: false,
      url,
      json: async () => (opts.method === 'POST' ? { id: 'call_1' } : fixtures.success)
    });
    await expect(makeProvider({ fetchImpl }).placeCall(task, {})).resolves.toEqual(
      expect.objectContaining({ outcome: 'quoted' })
    );
  });

  test('a fetch that rejects on a redirect gets a message saying so, not "fetch failed"', async () => {
    const fetchImpl = async () => {
      throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
    };
    await expect(makeProvider({ fetchImpl }).placeCall(task, {})).rejects.toThrow(
      /responded with a redirect; refusing to follow it with credentials attached/
    );
  });

  test('any other fetch failure is reported by its cause code, never its message', async () => {
    const fetchImpl = async () => {
      const cause = Object.assign(new Error('getaddrinfo ENOTFOUND api.heycall-e.com Bearer test-key'), { code: 'ENOTFOUND' });
      throw new TypeError('fetch failed', { cause });
    };
    const error = await makeProvider({ fetchImpl }).placeCall(task, {}).catch((e) => e);
    expect(error.message).toBe('CALL-E request failed before a response (ENOTFOUND).');
  });

  test('an abort or a request timeout still passes through as itself', async () => {
    for (const name of ['AbortError', 'TimeoutError']) {
      const fetchImpl = async () => {
        throw Object.assign(new Error(`operation ${name}`), { name });
      };
      const error = await makeProvider({ fetchImpl }).placeCall(task, {}).catch((e) => e);
      expect(error.name).toBe(name);
    }
  });

  // node --env-file turns "\n" inside a double-quoted value into a real newline, and fetch
  // then throws an error quoting the whole Authorization header.
  test.each([['a newline', 'sk_FAKE_A\nsk_FAKE_B'], ['a space', 'sk_FAKE A'], ['a CR', 'sk_FAKE\r']])(
    'refuses an API key containing %s, without echoing it',
    async (_label, apiKey) => {
      const error = (() => {
        try {
          makeProvider({ apiKey, fetchImpl: neverFetch });
        } catch (e) {
          return e;
        }
        return null;
      })();
      expect(error.message).toMatch(/CALLE_API_KEY contains whitespace or control characters/);
      expect(error.message).not.toContain('sk_FAKE');

      const provider = makeProvider({ fetchImpl: neverFetch });
      provider.apiKey = apiKey;
      const refused = await provider.placeCall(task, {}).catch((e) => e);
      expect(refused.message).toMatch(/CALLE_API_KEY contains whitespace/);
      expect(refused.message).not.toContain('sk_FAKE');
    }
  );

  test.each(['../../v2/admin', '..', '.', 'a/b', 'id?x=1', 'x'.repeat(129), ''])(
    'refuses to poll a call id that is not a plain token (%s)',
    async (id) => {
      let polls = 0;
      const fetchImpl = async (url, opts) => {
        if (opts.method !== 'POST') {
          polls += 1;
        }
        return { ok: true, json: async () => ({ id, status: 'queued' }) };
      };
      await expect(makeProvider({ fetchImpl }).placeCall(task, {})).rejects.toThrow(/id/);
      expect(polls).toBe(0);
    }
  );

  test('a call id with token punctuation stays one path segment on the pinned origin', async () => {
    const { calls, fetchImpl } = recordingFetch({ id: 'call:2026.09-13_x', status: 'queued' });
    await makeProvider({ fetchImpl }).placeCall(task, {});
    const pollUrl = new URL(calls[1].url);
    expect(pollUrl.origin).toBe('https://api.heycall-e.com');
    expect(pollUrl.pathname).toBe('/v1/calls/call%3A2026.09-13_x');
  });

  // The real fetch, not a stub: proves Node's own fetch honours redirect: 'error' and that
  // the redirect target never receives a request (so never sees the Authorization header).
  test('with the real fetch, a 302 is refused and its target is never contacted', async () => {
    const targetHits = [];
    const target = http.createServer((req, res) => {
      targetHits.push(req.headers.authorization);
      res.end('{}');
    });
    const api = http.createServer((req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${target.address().port}/v1/calls` });
      res.end();
    });
    await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
    await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
    try {
      const apiOrigin = `http://127.0.0.1:${api.address().port}`;
      const fetchImpl = (url, init) => fetch(url.replace('https://api.heycall-e.com', apiOrigin), init);
      await expect(makeProvider({ fetchImpl }).placeCall(task, {})).rejects.toThrow(
        /responded with a redirect; refusing to follow it/
      );
      expect(targetHits).toEqual([]);
    } finally {
      await new Promise((resolve) => api.close(resolve));
      await new Promise((resolve) => target.close(resolve));
    }
  });
});

// #524 item 3: "Reject incomplete/synthetic sample destinations and require an explicit
// authorized valid live destination."
describe('CallEProvider — only an explicitly authorized, complete, real destination is dialled', () => {
  async function expectRefusedBeforeDialing(provider, phone, pattern) {
    const seen = [];
    const refused = provider.placeCall(
      { ...task, suppliers: [{ name: 'Acme', phone }] },
      { onStatusChange: (s) => seen.push(s) }
    );
    await expect(refused).rejects.toThrow(pattern);
    // Refused before the task is marked dialing, and before any request is made
    // (every provider here is built with neverFetch).
    expect(seen).toEqual([]);
  }

  // Fed by the same scan tests/fictional-numbers.test.js runs, so a sample added anywhere in
  // the app is covered here too. Each must be refused on its own merits — as malformed,
  // incomplete, or fictional — not merely because this provider has an empty allowlist.
  test('under the default policy, every number written anywhere in the app is refused as a destination', async () => {
    const numbers = [...new Set(scan().map((f) => f.number))];
    expect(numbers.length).toBeGreaterThan(10);
    const provider = new CallEProvider({ apiKey: 'test-key', allowedDestinations: [], fetchImpl: neverFetch });
    const refusedOnlyByAllowlist = [];
    for (const phone of numbers) {
      await expectRefusedBeforeDialing(provider, phone, /refusing to dial/i);
      const error = await provider.placeCall({ ...task, suppliers: [{ name: 'Acme', phone }] }, {}).catch((e) => e);
      if (/No live destinations/.test(error.message)) {
        refusedOnlyByAllowlist.push(maskPhone(phone));
      }
    }
    expect(refusedOnlyByAllowlist).toEqual([]);
  });

  test('a "(0)" or trunk-0 spelling of a fictional number is still refused', async () => {
    const provider = new CallEProvider({ apiKey: 'test-key', allowedDestinations: [], fetchImpl: neverFetch });
    await expectRefusedBeforeDialing(provider, '+44 (0)20 7946 0958', /reserved for fiction/);
    await expectRefusedBeforeDialing(provider, '+44 020 7946 0958', /UK trunk 0 after \+44/);
    expect(() => new CallEProvider({ apiKey: 'test-key', allowedDestinations: ['+44 (0)20 7946 0958'] })).toThrow(
      /reserved for fiction/
    );
    expect(() => new CallEProvider({ apiKey: 'test-key', allowedDestinations: ['+44 020 7946 0958'] })).toThrow(
      /UK trunk 0/
    );
  });

  test('"(0)" is dropped the way a caller would drop it, never dialled as part of the number', async () => {
    const { calls, fetchImpl } = recordingFetch();
    await makeProvider({ fetchImpl }).placeCall({ ...task, suppliers: [{ name: 'Acme', phone: '+44 (0)20 7946 0958' }] }, {});
    expect(JSON.parse(calls[0].opts.body).recipients).toEqual([{ phones: [FIXTURE] }]);
  });

  test('the short NANP seed form is refused as incomplete', async () => {
    await expectRefusedBeforeDialing(
      makeProvider({ fetchImpl: neverFetch }),
      '+1-555-0100',
      /not a complete North American number/
    );
  });

  test('a complete number in a range reserved for fiction is refused as synthetic', async () => {
    await expectRefusedBeforeDialing(makeProvider({ fetchImpl: neverFetch }), '+1 202 555 0147', /reserved for fiction/);
  });

  test('an N11 service code is refused', async () => {
    await expectRefusedBeforeDialing(makeProvider({ fetchImpl: neverFetch }), '+1 911 555 0123', /N11 service code/);
  });

  test('a visibly truncated international number is refused', async () => {
    await expectRefusedBeforeDialing(makeProvider({ fetchImpl: neverFetch }), '+49 3012', /too short/);
  });

  test('with no allowlist configured, nothing is dialled', async () => {
    await expectRefusedBeforeDialing(
      makeProvider({ allowedDestinations: [], fetchImpl: neverFetch }),
      '+44 20 7946 0958',
      /No live destinations are authorized: set CALLE_ALLOWED_DESTINATIONS/
    );
  });

  test('a valid number the operator did not authorize is refused', async () => {
    const provider = makeProvider({ isFictionalDestination: () => false, fetchImpl: neverFetch });
    await expectRefusedBeforeDialing(provider, '+44 20 7946 0959', /not in CALLE_ALLOWED_DESTINATIONS/);
  });

  test('refusal messages never contain the number itself', async () => {
    const provider = makeProvider({ allowedDestinations: [], fetchImpl: neverFetch });
    for (const phone of ['+1-555-0100', '+1 202 555 0147', '+44 20 7946 0958', '+49 3012']) {
      const error = await provider.placeCall({ ...task, suppliers: [{ name: 'Acme', phone }] }, {}).catch((e) => e);
      const digits = phone.replace(/[^0-9]/g, '');
      expect(error.message.replace(/[^0-9]/g, '')).not.toContain(digits.slice(-5));
    }
  });

  test('an allowlist entry reserved for fiction fails construction, masked', () => {
    expect(() => new CallEProvider({ apiKey: 'test-key', allowedDestinations: [FIXTURE] })).toThrow(
      /entry #1 \(\+•••••58\) is a number reserved for fiction/
    );
  });

  test('an invalid allowlist entry fails construction, naming its position', () => {
    expect(() => makeProvider({ allowedDestinations: [FIXTURE, '+1-555-0100'] })).toThrow(
      /entry #2: Supplier phone \+•••••00 is not a complete North American number/
    );
  });

  test('CALLE_ALLOWED_DESTINATIONS is read at construction, comma-separated', () => {
    const saved = process.env.CALLE_ALLOWED_DESTINATIONS;
    process.env.CALLE_ALLOWED_DESTINATIONS = ` ${FIXTURE} , ,`;
    try {
      const provider = new CallEProvider({ apiKey: 'test-key', isFictionalDestination: acceptFixtureOnly });
      expect([...provider.allowedDestinations]).toEqual([FIXTURE]);
    } finally {
      if (saved === undefined) {
        delete process.env.CALLE_ALLOWED_DESTINATIONS;
      } else {
        process.env.CALLE_ALLOWED_DESTINATIONS = saved;
      }
    }
  });

  test.each([
    [undefined, []],
    ['', []],
    [' , ,', []],
    ['a,', ['a']],
    [' a , b ', ['a', 'b']]
  ])('parseAllowlistEnv(%p) -> %p', (value, expected) => {
    expect(parseAllowlistEnv(value)).toEqual(expected);
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
