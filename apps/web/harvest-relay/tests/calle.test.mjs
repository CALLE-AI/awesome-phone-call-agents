import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { CalleClient, buildCallRequest, createReservedCall, loadReservation } from '../src/calle.mjs';
import { createAppServer } from '../src/server.mjs';
import { main } from '../src/cli.mjs';

const scenario = JSON.parse(await readFile(new URL('../web/scenario.json', import.meta.url), 'utf8'));
const phone = '+12025550123';
const key = 'iams_live_test_secret_never_print';
const options = { providerType: 'storage', providerId: 'orchard', phone, region: 'US', locale: 'en-US' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const client = (fetchImpl, extra = {}) => new CalleClient({ apiKey: key, fetchImpl, ...extra });
async function runtime(t) {
  const dir = await mkdtemp(join(tmpdir(), 'harvest-relay-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
function callInput(runtimeDir, calleClient, extra = {}) {
  return { client: calleClient, request: buildCallRequest(scenario, options), operationId: 'lot-042-orchard-1', confirm: true, allowedPhones: phone, runtimeDir, ...extra };
}

test('storage preview uses the official recipient contract and does not seed fictional answers', () => {
  const request = buildCallRequest(scenario, options);
  assert.deepEqual(Object.keys(request).sort(), ['metadata', 'recipient_result_schema', 'recipients', 'task']);
  assert.deepEqual(request.recipients, [{ phones: [phone], region: 'US', locale: 'en-US' }]);
  assert.equal(request.metadata.source_provenance, 'synthetic');
  assert.equal(request.metadata.booking_authorized, false);
  assert.match(request.task, /fictional|synthetic/i);
  assert.match(request.task, /900/);
  assert.doesNotMatch(request.task, /1200|twelve hundred|Ninety dollars/);
  assert.deepEqual(request.recipient_result_schema.required, ['availability', 'evidence']);
  assert.deepEqual(request.recipient_result_schema.properties.availability.enum, ['yes', 'no', 'unknown']);
  assert.equal(request.recipient_result_schema.additionalProperties, false);
  assert.equal(request.recipient_result_schema.properties.receive_until_min.type, 'integer');
  assert.ok(!request.recipient_result_schema.required.includes('capacity_kg'), 'unknown numeric facts must remain absent');
});

test('carrier preview asks for route times for every storage without supplying fixture quotes', () => {
  const request = buildCallRequest(scenario, { ...options, providerType: 'carrier', providerId: 'swift' });
  assert.equal(request.metadata.provider_type, 'carrier');
  assert.deepEqual(Object.keys(request.recipient_result_schema.properties.travel_min.properties), scenario.storages.map(s => s.id));
  assert.equal(request.recipient_result_schema.properties.pickup_min.type, 'integer');
  assert.doesNotMatch(request.task, /One hundred sixty|13:35|fifty minutes/i);
});

test('preview rejects malformed numbers, unsupported regions, and missing providers', () => {
  assert.throws(() => buildCallRequest(scenario, { ...options, phone: '2025550123' }), { code: 'invalid_phone' });
  assert.throws(() => buildCallRequest(scenario, { ...options, region: 'CN' }), { code: 'unsupported_region' });
  assert.throws(() => buildCallRequest(scenario, { ...options, providerId: 'not-present' }), { code: 'invalid_provider' });
});

test('authentication uses only the documented read-only Goals endpoint', async () => {
  let calls = 0;
  const result = await client(async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.heycall-e.com/v1/goals?limit=1');
    assert.equal(init.method, 'GET');
    assert.equal(init.headers.Authorization, `Bearer ${key}`);
    assert.equal(init.redirect, 'error');
    assert.equal(init.body, undefined);
    return json({ object: 'list', data: [], next_cursor: null });
  }).check();
  assert.equal(result.connected, true);
  assert.equal(result.goal_count, 0);
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(result).includes(key));
});

test('missing authentication fails before any network request', async () => {
  let calls = 0;
  const unconfigured = new CalleClient({ apiKey: '', fetchImpl: async () => { calls++; return json({}); } });
  await assert.rejects(() => unconfigured.check(), { code: 'not_configured' });
  assert.equal(calls, 0);
  assert.ok(!JSON.stringify(client(async () => json({}))).includes(key));
});

test('upstream authentication errors never expose reflected credentials or raw messages', async () => {
  await assert.rejects(() => client(async () => json({ error: { code: 'unauthorized', message: `bad Bearer ${key}`, details: { key } } }, 401)).check(), error => {
    assert.equal(error.code, 'unauthorized');
    assert.equal(error.status, 401);
    assert.ok(!JSON.stringify(error).includes(key));
    assert.ok(!error.message.includes(key));
    return true;
  });
});

test('live creation persists a private reservation before POST and records the accepted ID', async t => {
  const dir = await runtime(t);
  let calls = 0;
  const request = buildCallRequest(scenario, options);
  const result = await createReservedCall(callInput(dir, client(async (url, init) => {
    calls++;
    const saved = await loadReservation(dir, 'lot-042-orchard-1');
    assert.equal(saved.state, 'reserved');
    assert.deepEqual(saved.request, request);
    assert.equal(saved.idempotency_key, init.headers['Idempotency-Key']);
    assert.equal(url, 'https://api.heycall-e.com/v1/calls');
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), request);
    return json({ id: 'call_accepted', status: 'queued' }, 201);
  })));
  assert.equal(calls, 1);
  assert.equal(result.call.id, 'call_accepted');
  const saved = await loadReservation(dir, 'lot-042-orchard-1');
  assert.equal(saved.state, 'accepted');
  assert.equal(saved.call_id, 'call_accepted');
  const files = await readdir(dir);
  assert.equal(files.length, 1);
  const content = await readFile(join(dir, files[0]), 'utf8');
  assert.ok(!content.includes(key));
  assert.equal((await stat(join(dir, files[0]))).mode & 0o777, 0o600);
});

test('live gates require explicit confirmation and an exact allowlisted phone', async t => {
  const dir = await runtime(t);
  let calls = 0;
  const c = client(async () => { calls++; return json({ id: 'call_bad' }, 201); });
  await assert.rejects(() => createReservedCall(callInput(dir, c, { confirm: false })), { code: 'confirmation_required' });
  await assert.rejects(() => createReservedCall(callInput(dir, c, { allowedPhones: `${phone}9` })), { code: 'phone_not_allowed' });
  await assert.rejects(() => createReservedCall(callInput(dir, c, { allowedPhones: '' })), { code: 'phone_not_allowed' });
  await assert.rejects(() => createReservedCall(callInput(dir, c, { operationId: '' })), { code: 'operation_id_required' });
  assert.equal(calls, 0);
  assert.equal((await readdir(dir)).length, 0);
});

test('concurrent duplicate operations reserve once and never place a second call', async t => {
  const dir = await runtime(t);
  let calls = 0;
  const c = client(async () => { calls++; return json({ id: 'call_once', status: 'queued' }, 201); });
  const outcomes = await Promise.allSettled([createReservedCall(callInput(dir, c)), createReservedCall(callInput(dir, c))]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(x => x.status === 'rejected').reason.code, 'duplicate_operation');
  assert.equal(calls, 1);
});

test('an uncertain POST is saved as unknown and reusing its operation is refused', async t => {
  const dir = await runtime(t);
  let calls = 0;
  const c = client(async () => { calls++; throw new Error(`socket failed for ${key}`); });
  await assert.rejects(() => createReservedCall(callInput(dir, c)), error => {
    assert.equal(error.code, 'network_error');
    assert.equal(error.acceptance, 'unknown');
    assert.ok(!error.message.includes(key));
    return true;
  });
  const saved = await loadReservation(dir, 'lot-042-orchard-1');
  assert.equal(saved.state, 'unknown');
  assert.equal(saved.call_id, null);
  assert.ok(!JSON.stringify(saved).includes(key));
  await assert.rejects(() => createReservedCall(callInput(dir, c)), { code: 'duplicate_operation' });
  assert.equal(calls, 1);
});

test('a successful HTTP response without a usable call ID remains uncertain', async t => {
  const dir = await runtime(t);
  await assert.rejects(() => createReservedCall(callInput(dir, client(async () => json({ status: 'queued' }, 201)))), { code: 'invalid_response' });
  assert.equal((await loadReservation(dir, 'lot-042-orchard-1')).state, 'unknown');
});

test('timeouts abort the request once without a resend', async () => {
  let calls = 0;
  await assert.rejects(() => client(async (_url, { signal }) => {
    calls++;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  }, { timeoutMs: 10 }).check(), { code: 'timeout' });
  assert.equal(calls, 1);
});

test('timeouts while reading a response body remain clearly identified as timeouts', async () => {
  await assert.rejects(() => client(async (_url, { signal }) => ({
    ok: true,
    status: 200,
    json: () => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
  }), { timeoutMs: 10 }).check(), { code: 'timeout' });
});

test('mutating the original request cannot change the destination after allowlist validation', async t => {
  const dir = await runtime(t);
  let sentPhone;
  const request = buildCallRequest(scenario, options);
  const pending = createReservedCall(callInput(dir, client(async (_url, init) => {
    sentPhone = JSON.parse(init.body).recipients[0].phones[0];
    return json({ id: 'call_snapshot', status: 'queued' }, 201);
  }), { request }));
  request.recipients[0].phones[0] = '+12025550999';
  await pending;
  assert.equal(sentPhone, phone);
});

test('status and event reads preserve the call ID and encode pagination data', async () => {
  const urls = [];
  const c = client(async (url, init) => { urls.push(url); assert.equal(init.method, 'GET'); return json({ id: 'call_read', data: [] }); });
  await c.getCall('call_read');
  await c.getEvents('call_read', { cursor: 'a+b/next', limit: 10 });
  assert.deepEqual(urls, ['https://api.heycall-e.com/v1/calls/call_read', 'https://api.heycall-e.com/v1/calls/call_read/events?limit=10&cursor=a%2Bb%2Fnext']);
  await assert.rejects(() => c.getEvents('call_read', { limit: 101 }), { code: 'invalid_limit' });
});

async function localServer(t, fetchImpl = async () => json({ data: [] }), env = { CALLE_API_KEY: key }) {
  const server = createAppServer({ env, fetchImpl });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('local health reveals configuration only, and preview never contacts CALL-E', async t => {
  let requests = 0;
  const base = await localServer(t, async () => { requests++; return json({ data: [] }); });
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.configured, true);
  assert.ok(!JSON.stringify(health).includes(key));
  const response = await fetch(`${base}/api/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider_type: 'storage', provider_id: 'orchard', phone, region: 'US', locale: 'en-US' }) });
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.equal(preview.dialed, false);
  assert.deepEqual(preview.request.recipients[0].phones, [`${phone.slice(0, 2)}***${phone.slice(-4)}`]);
  assert.equal(requests, 0);
});

test('HTTP integration check is read-only and no public create endpoint exists', async t => {
  let calls = 0;
  const base = await localServer(t, async (url, init) => {
    calls++;
    assert.equal(init.method, 'GET');
    assert.ok(url.endsWith('/v1/goals?limit=1'));
    return json({ data: [] });
  });
  const checked = await (await fetch(`${base}/api/check`, { method: 'POST' })).json();
  assert.equal(checked.connected, true);
  for (const path of ['/api/call', '/api/calls', '/api/create']) {
    const denied = await fetch(base + path, { method: 'POST', body: '{}' });
    assert.equal(denied.status, 404);
  }
  assert.equal(calls, 1);
});

test('static serving stays inside web, hides dotfiles, and sends module content type', async t => {
  const dir = await runtime(t);
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>Test</title>');
  await writeFile(join(dir, 'demo.js'), 'export const demo = true;');
  await writeFile(join(dir, '.env'), key);
  const server = createAppServer({ webDir: dir, env: {} });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const index = await fetch(base);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /Test/);
  const module = await fetch(`${base}/demo.js`);
  assert.match(module.headers.get('Content-Type'), /javascript/);
  assert.equal((await fetch(`${base}/.env`)).status, 403);
  assert.equal((await fetch(`${base}/%2e%2e%2fPLAN.md`)).status, 403);
  assert.equal((await fetch(`${base}/runtime/secret.json`)).status, 404);
});

test('CLI preview works without credentials; call refuses missing confirmation', async () => {
  const output = [];
  const errors = [];
  const io = { env: {}, stdout: value => output.push(value), stderr: value => errors.push(value) };
  const args = ['--type', 'storage', '--provider', 'orchard', '--phone', phone];
  assert.equal(await main(['preview', ...args], io), 0);
  assert.equal(JSON.parse(output[0]).dialed, false);
  assert.equal(await main(['call', ...args, '--operation-id', 'cli-test'], io), 1);
  assert.equal(JSON.parse(errors[0]).error.code, 'confirmation_required');
});

test('CLI masks E.164 phone numbers in displayed previews without changing the request builder', async () => {
  const output = [];
  const result = await main(['preview', '--type', 'storage', '--provider', 'orchard', '--phone', phone], { env: {}, stdout: value => output.push(value), stderr: () => {} });
  assert.equal(result, 0);
  assert.ok(!output[0].includes(phone));
  assert.equal(JSON.parse(output[0]).request.recipients[0].phones[0], '+1***0123');
  assert.deepEqual(buildCallRequest(scenario, options).recipients[0].phones, [phone]);
});
