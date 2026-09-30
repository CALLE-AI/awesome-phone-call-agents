import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CalleTransport, CreateRejected, DispatchUnknown, CALLE_ORIGIN } from '../server/calle';
describe('CALL-E HTTP adapter with injected no-network requests', () => {
  it('uses the official endpoint, server authorization, exact payload and stable key', async () => {
    const payload = { task: 'Synthetic test only' };
    const transport = new CalleTransport('test-key', async (url, init) => {
      assert.equal(url, `${CALLE_ORIGIN}/v1/calls`);
      assert.equal(init?.method, 'POST');
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-key');
      assert.equal(new Headers(init?.headers).get('Idempotency-Key'), 'stable-test-key');
      assert.deepEqual(JSON.parse(String(init?.body)), payload);
      assert.equal(init?.redirect, 'error');
      return Response.json({ call_id: 'call_123' });
    });
    assert.equal(await transport.create(payload, 'stable-test-key'), 'call_123');
  });
  it('classifies a definitive rejection separately from uncertain dispatch', async () => {
    for (const status of [400, 401, 403, 422, 429, 500, 503]) {
      let requests = 0;
      const transport = new CalleTransport('test-key', async () => {
        requests++;
        return new Response('', { status });
      });
      await assert.rejects(
        () => transport.create({}, 'same-key'),
        [400, 401, 403, 422].includes(status) ? CreateRejected : DispatchUnknown,
      );
      assert.equal(requests, 1);
    }
  });
  it('never retries a lost create response or an invalid returned ID', async () => {
    for (const request of [
      async () => {
        throw new Error('Timeout');
      },
      async () => Response.json({ id: '../bad' }),
      async () => new Response('{invalid'),
    ]) {
      await assert.rejects(
        () => new CalleTransport('test-key', request).create({}, 'key'),
        DispatchUnknown,
      );
    }
  });
  it('status lookup is GET only and validates IDs before using the transport', async () => {
    let requests = 0;
    const transport = new CalleTransport('test-key', async (url, init) => {
      requests++;
      assert.equal(url, `${CALLE_ORIGIN}/v1/calls/call_123`);
      assert.equal(init?.method || 'GET', 'GET');
      assert.equal(init?.body, undefined);
      return Response.json({ status: 'completed' });
    });
    await assert.rejects(() => transport.read('../invalid'), /Invalid provider/);
    assert.equal(requests, 0);
    assert.deepEqual(await transport.read('call_123'), { status: 'completed' });
    assert.equal(requests, 1);
  });
});

describe('CALL-E result-schema compatibility and rejection diagnostics', () => {
  it('restricts both extraction schemas to this call’s approved fields without leaking scope between calls', async () => {
    const { callPayload } = await import('../server/calle');
    const recipient = {
      id: 'synthetic',
      name: 'Test shop',
      phone: '+12025550101',
      consentRef: 'fixture',
      timezone: 'UTC',
    };
    const initial = callPayload('Synthetic inquiry', recipient, 'initial', [
      'service',
      'budget',
      'dropoff',
    ]);
    const followup = callPayload('Synthetic follow-up', recipient, 'followup', ['budget']);
    for (const schema of [initial.result_schema, initial.recipient_result_schema]) {
      assert.deepEqual(schema.properties.facts.items.properties.field.enum, [
        'service',
        'budget',
        'dropoff',
      ]);
      assert.ok(
        !schema.properties.facts.items.properties.field.enum.includes('price_final_all_in'),
      );
    }
    assert.deepEqual(
      followup.recipient_result_schema.properties.facts.items.properties.field.enum,
      ['budget'],
    );
    assert.throws(() => callPayload('No fields', recipient, 'invalid', []));
  });
  it('uses only the documented schema subset while preserving local validation', async () => {
    const { resultSchema } = await import('../server/calle');
    const allowed = new Set([
      'type',
      'properties',
      'required',
      'enum',
      'items',
      'description',
      'additionalProperties',
    ]);
    function inspect(node: Record<string, unknown>) {
      for (const keyword of Object.keys(node)) assert.ok(allowed.has(keyword), keyword);
      assert.equal(typeof node.type, 'string');
      if (node.properties)
        for (const child of Object.values(node.properties as object)) inspect(child);
      if (node.items) inspect(node.items as Record<string, unknown>);
    }
    inspect(resultSchema);
    assert.ok(!resultSchema.properties.facts.items.required.includes('expires_at'));
  });
  it('exposes only known static rejection reasons, never raw provider errors', async () => {
    for (const code of [
      'result_schema_invalid',
      'recipient_result_schema_invalid',
      'insufficient_balance',
      'untrusted-secret',
      '__proto__',
    ]) {
      const transport = new CalleTransport('test-key', async () =>
        Response.json(
          {
            error: {
              code,
              message: 'private-phone-and-secret',
              details: { token: 'private-token' },
            },
          },
          { status: 400 },
        ),
      );
      await assert.rejects(
        () => transport.create({}, 'key'),
        (error: unknown) => {
          assert.ok(error instanceof CreateRejected);
          assert.ok(!/private|untrusted-secret|__proto__/.test(error.message));
          if (code.includes('schema_invalid'))
            assert.match(error.message, /schema is not supported/);
          if (code === 'insufficient_balance') assert.match(error.message, /insufficient balance/);
          return true;
        },
      );
    }
  });
  it('keeps an idempotency conflict uncertain even if returned as HTTP 400', async () => {
    const transport = new CalleTransport('test-key', async () =>
      Response.json({ error: { code: 'idempotency_conflict' } }, { status: 400 }),
    );
    await assert.rejects(() => transport.create({}, 'key'), DispatchUnknown);
  });
});

it('preserves raw bytes when recovering a saved request instead of reserializing it', async () => {
  const body = '{ "task": "Synthetic test", "metadata": {"id":"original"} }';
  let requests = 0;
  const transport = new CalleTransport('fake', async (_url, init) => {
    requests++;
    assert.equal(init!.body, body);
    assert.equal(new Headers(init!.headers).get('Idempotency-Key'), 'original-key');
    return Response.json({ id: 'call_original' });
  });
  assert.equal(await transport.recover(body, 'original-key'), 'call_original');
  assert.equal(requests, 1);
});

it('distinguishes queueing and result preparation from provider call handling', async () => {
  const { providerPhase } = await import('../server/calle');
  assert.equal(providerPhase({ status: 'queued' }), 'queued');
  assert.equal(
    providerPhase({ status: 'in_progress', recipients: [{ status: 'completed' }] }),
    'finalizing',
  );
  assert.equal(
    providerPhase({ status: 'in_progress', recipients: [{ status: 'in_progress' }] }),
    'calling',
  );
  assert.equal(providerPhase({ status: 'undocumented' }), 'waiting');
});
