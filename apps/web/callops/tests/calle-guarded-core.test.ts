import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FixedCalleMcpTransport } from '../src/adapters/fixed-calle-mcp-transport';
import { FileCalleRunCheckpointStore } from '../src/adapters/file-calle-run-checkpoint-store';
import { fingerprintPlan } from '../src/domain/canonical';
import type { CallPlan } from '../src/domain/models';
import { interpretWorkshopTranscript } from '../src/domain/workshop-outcome';
import { CalleLiveAdapter } from '../src/integrations/calle-live-adapter';
import { asCalleConfirmToken, asCallePlanId, asCalleRunId } from '../src/integrations/calle-live-capability-vault';
import type { CalleBackendAuthenticationBoundary } from '../src/integrations/calle-live-auth-boundary';
import { DISABLED_CALLE_LIVE_TRANSPORT_POLICY } from '../src/integrations/calle-live-transport-policy';
import { createCalleCoreSession, createCalleDiscovery } from '../tools/calle-cli/guarded-calle-core.mjs';
import { CALLE_PROTOCOL_VERSION, CalleHttpBoundaryError, createBoundedCalleFetch, PINNED_CALLE_URL } from '../tools/calle-cli/guarded-mcp-fetch.mjs';

const roots: string[] = [];
const guards: ReturnType<typeof createBoundedCalleFetch>[] = [];
const SYNTHETIC_TOKEN = 'SYNTHETIC_R3_CREDENTIAL_NOT_REAL';
const headers = {
  Authorization: `Bearer ${SYNTHETIC_TOKEN}`, 'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream', 'mcp-protocol-version': CALLE_PROTOCOL_VERSION,
};
const initialize = { jsonrpc: '2.0', id: 'calle-initialize', method: 'initialize', params: { protocolVersion: CALLE_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'callops', version: '0.1.0' } } };
const notification = { jsonrpc: '2.0', method: 'notifications/initialized', params: {} };
const listing = { jsonrpc: '2.0', id: 'calle-tools-list', method: 'tools/list', params: {} };
const capability = { planId: asCallePlanId('SYNTHETIC_R3_PLAN'), confirmToken: asCalleConfirmToken('SYNTHETIC_R3_CONFIRMATION') };

function request(payload: unknown, overrides: RequestInit = {}): RequestInit {
  return { method: 'POST', headers, body: JSON.stringify(payload), ...overrides };
}
function jsonResponse(id: string, result: unknown, extra: ResponseInit = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200, ...extra });
}
function initializeResponse(): Response {
  return jsonResponse('calle-initialize', { protocolVersion: CALLE_PROTOCOL_VERSION, capabilities: {}, serverInfo: { name: 'synthetic-r3', version: '1' } }, { headers: { 'mcp-session-id': 'SYNTHETIC_SESSION' } });
}
function protocolFetch(last: unknown = { tools: [] }): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>((_url, init) => {
    const payload = JSON.parse(init?.body as string) as { method: string; id: string };
    if (payload.method === 'initialize') return Promise.resolve(initializeResponse());
    if (payload.method === 'notifications/initialized') return Promise.resolve(new Response(null, { status: 202 }));
    return Promise.resolve(jsonResponse(payload.id, last));
  });
}
function guardFor(fetchImpl: typeof fetch, limits = {}): ReturnType<typeof createBoundedCalleFetch> {
  const guard = createBoundedCalleFetch('tools/list', fetchImpl, { limits });
  guards.push(guard);
  return guard;
}
async function syntheticCache(): Promise<{ root: string; token: string; before: string }> {
  const root = await mkdtemp(join(tmpdir(), 'callops-r3-'));
  roots.push(root);
  const folder = join(root, createHash('md5').update(PINNED_CALLE_URL).digest('hex'));
  await mkdir(folder);
  const token = join(folder, 'token.json');
  const before = JSON.stringify({ token: { access_token: SYNTHETIC_TOKEN }, expires_at: '2099-01-01T00:00:00.000Z' });
  await writeFile(token, before);
  return { root, token, before };
}

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Uninjected network is forbidden in R3 tests.'); })); });
afterEach(async () => {
  for (const guard of guards.splice(0)) guard.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !root.startsWith(join(tmpdir(), 'callops-r3-'))) throw new Error('Unexpected synthetic cleanup root.');
    await rm(root, { recursive: true, force: true });
  }
});

describe('closed HTTP request boundary', () => {
  it.each([
    PINNED_CALLE_URL.replace('seleven-mcp-sg.airudder.com', 'seleven-mcp-sg.airudder.com.attacker.invalid'),
    PINNED_CALLE_URL.replace('https://', 'https://user@'),
    PINNED_CALLE_URL.replace('.com/', '.com:444/'),
    PINNED_CALLE_URL.replace('.com/', '.com:443/'),
    PINNED_CALLE_URL + '?extra=1', PINNED_CALLE_URL + '#extra',
    PINNED_CALLE_URL.replace('https:', 'http:'), PINNED_CALLE_URL + '/',
  ])('rejects a nonliteral endpoint before dispatch: %s', async (url) => {
    const fake = protocolFetch();
    const guard = guardFor(fake);
    await expect(guard.fetch(url, request(initialize))).rejects.toMatchObject({ code: 'NETWORK_POLICY_VIOLATION' });
    expect(fake).not.toHaveBeenCalled();
    expect(guard.observation().attemptedRequests).toBe(0);
  });
  it.each([
    { method: 'GET' }, { headers: { ...headers, 'X-Unreviewed': 'unexpected' } },
    { headers: { ...headers, authorization: 'duplicate' } },
    { headers: { ...headers, Authorization: 'Bearer bad\r\nX-Injected: value' } },
    { headers: { ...headers, 'mcp-session-id': 'x'.repeat(513) } },
    { redirect: 'follow' },
  ])('rejects unreviewed method/header/options %j', async (overrides) => {
    const fake = protocolFetch();
    const guard = guardFor(fake);
    await expect(guard.fetch(PINNED_CALLE_URL, request(initialize, overrides as RequestInit))).rejects.toMatchObject({ code: 'NETWORK_POLICY_VIOLATION' });
    expect(fake).not.toHaveBeenCalled();
  });
  it('passes the pinned URL, POST, explicit redirect refusal and only allowlisted headers to fetch', async () => {
    const fake = protocolFetch();
    const guard = guardFor(fake);
    await guard.fetch(PINNED_CALLE_URL, request(initialize));
    expect(fake).toHaveBeenCalledWith(PINNED_CALLE_URL, expect.objectContaining({ method: 'POST', redirect: 'error', credentials: 'omit' }));
    expect(fake.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    const sent = fake.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(Object.keys(sent).sort()).toEqual(['accept', 'authorization', 'content-type', 'mcp-protocol-version']);
  });
  it.each([301, 302, 307, 308])('refuses HTTP %i without following Location', async (status) => {
    const fake = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status, headers: { Location: 'https://attacker.invalid/' } })));
    const guard = guardFor(fake);
    await expect(guard.fetch(PINNED_CALLE_URL, request(initialize))).rejects.toMatchObject({ code: 'REDIRECT_REFUSED' });
    await expect(guard.fetch(PINNED_CALLE_URL, request(initialize))).rejects.toThrow();
    expect(fake).toHaveBeenCalledTimes(1);
  });
  it('rejects a surprising final URL or a response reported as redirected', async () => {
    for (const property of ['url', 'redirected']) {
      const response = initializeResponse();
      Object.defineProperty(response, property, { value: property === 'url' ? 'https://attacker.invalid/' : true });
      const guard = guardFor(vi.fn<typeof fetch>(() => Promise.resolve(response)));
      await expect(guard.fetch(PINNED_CALLE_URL, request(initialize))).rejects.toMatchObject({ code: 'NETWORK_POLICY_VIOLATION' });
    }
  });
  it('allows only the three ordered stages and refuses a fourth request', async () => {
    const fake = protocolFetch();
    const guard = guardFor(fake);
    for (const payload of [initialize, notification, listing]) await guard.fetch(PINNED_CALLE_URL, request(payload));
    await expect(guard.fetch(PINNED_CALLE_URL, request(listing))).rejects.toMatchObject({ code: 'REQUEST_BUDGET_EXCEEDED' });
    expect(fake).toHaveBeenCalledTimes(3);
    const wrong = guardFor(protocolFetch());
    await expect(wrong.fetch(PINNED_CALLE_URL, request(listing))).rejects.toMatchObject({ code: 'PROTOCOL_REQUEST_INVALID' });
    expect(wrong.observation().attemptedRequests).toBe(0);
  });
  it('counts a failed attempt and never reuses its slot', async () => {
    const fake = vi.fn<typeof fetch>(() => Promise.reject(new Error(SYNTHETIC_TOKEN)));
    const guard = guardFor(fake);
    await expect(guard.fetch(PINNED_CALLE_URL, request(initialize))).rejects.toMatchObject({ code: 'NETWORK_FAILED', message: 'NETWORK_FAILED' });
    await expect(guard.fetch(PINNED_CALLE_URL, request(initialize))).rejects.toThrow('NETWORK_FAILED');
    expect(guard.observation().attemptedRequests).toBe(1);
    expect(fake).toHaveBeenCalledTimes(1);
    expect(new CalleHttpBoundaryError(SYNTHETIC_TOKEN).message).toBe('NETWORK_FAILED');
  });
  it('refuses an action tool in the read-only discovery sequence', async () => {
    const fake = protocolFetch();
    const guard = guardFor(fake);
    await guard.fetch(PINNED_CALLE_URL, request(initialize));
    await guard.fetch(PINNED_CALLE_URL, request(notification));
    await expect(guard.fetch(PINNED_CALLE_URL, request({ jsonrpc: '2.0', id: 'calle-run_call', method: 'tools/call', params: { name: 'run_call', arguments: {} } }))).rejects.toThrow('PROTOCOL_REQUEST_INVALID');
    expect(fake).toHaveBeenCalledTimes(2);
    expect(guard.observation().selectedOperationDispatched).toBe(false);
  });
  it('counts actual UTF-8 bytes, and shares the request budget across protocol stages', async () => {
    const body = JSON.stringify({ ...initialize, padding: 'é'.repeat(100) });
    const fake = protocolFetch();
    const utf8 = guardFor(fake, { maximumRequestBytes: body.length });
    await expect(utf8.fetch(PINNED_CALLE_URL, request(null, { body }))).rejects.toMatchObject({ code: 'REQUEST_TOO_LARGE' });
    expect(fake).not.toHaveBeenCalled();
    const bytes = Buffer.byteLength(JSON.stringify(initialize));
    const aggregate = guardFor(fake, { maximumRequestBytes: bytes });
    await aggregate.fetch(PINNED_CALLE_URL, request(initialize));
    await expect(aggregate.fetch(PINNED_CALLE_URL, request(notification))).rejects.toThrow('REQUEST_TOO_LARGE');
    expect(aggregate.observation().requestBytes).toBe(bytes);
  });
});

describe('response size and timing before accumulation', () => {
  it('bounds an individual stalled request and aborts its signal', async () => {
    vi.useFakeTimers();
    const fake = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
    const guard = guardFor(fake, { perRequestTimeoutMs: 20, timeoutMs: 100 });
    const result = guard.fetch(PINNED_CALLE_URL, request(initialize)).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(20);
    expect(await result).toMatchObject({ code: 'REQUEST_TIMEOUT' });
    expect(fake.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(guard.observation().attemptedRequests).toBe(1);
  });
  it('rejects an excessive Content-Length before acquiring a body reader', async () => {
    const response = new Response('x', { headers: { 'content-length': '1000' } });
    const read = vi.spyOn(response.body!, 'getReader');
    const guard = guardFor(vi.fn<typeof fetch>(() => Promise.resolve(response)), { maximumResponseBytes: 64 });
    await expect(guard.fetch(PINNED_CALLE_URL, request(initialize))).rejects.toThrow('RESPONSE_TOO_LARGE');
    expect(read).not.toHaveBeenCalled();
  });
  it.each([null, '1'])('bounds streamed bytes despite a missing/lying length (%s)', async (length) => {
    let pulled = 0;
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { pulled += 1; controller.enqueue(new Uint8Array(40)); }, cancel: cancelled });
    const response = new Response(stream, length === null ? {} : { headers: { 'content-length': length } });
    const textSpy = vi.spyOn(response, 'text');
    const guard = guardFor(vi.fn<typeof fetch>(() => Promise.resolve(response)), { maximumResponseBytes: 64 });
    await expect(guard.fetch(PINNED_CALLE_URL, request(initialize))).rejects.toThrow('RESPONSE_TOO_LARGE');
    expect(guard.observation().responseBytes).toBe(80);
    expect(pulled).toBeLessThanOrEqual(3);
    expect(textSpy).not.toHaveBeenCalled();
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
  it('shares response byte accounting across the handshake and selected operation', async () => {
    const first = initializeResponse();
    const initialBytes = Buffer.byteLength(await first.clone().text());
    const guard = guardFor(protocolFetch(), { maximumResponseBytes: initialBytes });
    await guard.fetch(PINNED_CALLE_URL, request(initialize));
    await guard.fetch(PINNED_CALLE_URL, request(notification));
    await expect(guard.fetch(PINNED_CALLE_URL, request(listing))).rejects.toThrow('RESPONSE_TOO_LARGE');
    expect(guard.observation().attemptedRequests).toBe(3);
  });
  it('uses a single global deadline across stages instead of resetting it', async () => {
    vi.useFakeTimers();
    const fake = vi.fn<typeof fetch>((_url, init) => new Promise((resolveResponse) => {
      setTimeout(() => resolveResponse((JSON.parse(init?.body as string) as { method: string }).method === 'initialize' ? initializeResponse() : new Response(null, { status: 202 })), 25);
    }));
    const guard = guardFor(fake, { timeoutMs: 50, perRequestTimeoutMs: 40 });
    const first = guard.fetch(PINNED_CALLE_URL, request(initialize));
    await vi.advanceTimersByTimeAsync(25);
    await first;
    const second = guard.fetch(PINNED_CALLE_URL, request(notification)).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(25);
    expect(await second).toMatchObject({ code: 'OPERATION_TIMEOUT' });
    expect(guard.observation().selectedOperationDispatched).toBe(false);
    expect(fake).toHaveBeenCalledTimes(2);
  });
  it('propagates cancellation into an active stream read without waiting for another chunk', async () => {
    const controller = new AbortController();
    const cancelled = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel: cancelled }));
    const fake = vi.fn<typeof fetch>(() => Promise.resolve(response));
    const guard = createBoundedCalleFetch('tools/list', fake, { signal: controller.signal });
    guards.push(guard);
    const pending = guard.fetch(PINNED_CALLE_URL, request(initialize)).catch((error: unknown) => error);
    await vi.waitFor(() => expect(response.body?.locked).toBe(true));
    controller.abort('SYNTHETIC_UNTRUSTED_ABORT_REASON');
    expect(await pending).toMatchObject({ code: 'ABORTED', message: 'ABORTED' });
    expect(fake.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
  it.each([new Uint8Array([255]), new TextEncoder().encode('{invalid'), new TextEncoder().encode(JSON.stringify({ jsonrpc: '2.0', id: 'wrong', result: {} }))])('refuses malformed, invalid-encoding or uncorrelated protocol responses', async (body) => {
    const response = new Response(body);
    const guard = guardFor(vi.fn<typeof fetch>(() => Promise.resolve(response)));
    await expect(guard.fetch(PINNED_CALLE_URL, request(initialize))).rejects.toThrow('PROTOCOL_RESPONSE_INVALID');
    expect(guard.observation().attemptedRequests).toBe(1);
  });
});

describe('real pinned Core with synthetic cache and fake HTTP', () => {
  it('keeps discovery disabled by default and exposes no arbitrary tool entry', async () => {
    const fake = protocolFetch();
    const discovery = createCalleDiscovery({ fetchImpl: fake, cacheRoot: 'not-a-real-cache' });
    await expect(discovery.listTools()).rejects.toThrow('DISCOVERY_OR_SESSION_DISABLED');
    expect(Object.keys(discovery).sort()).toEqual(['listTools', 'observation']);
    expect(fake).not.toHaveBeenCalled();
    expect(discovery.observation().attemptedRequests).toBe(0);
  });
  it('executes the three Core requests once, without cache mutation, broker or telemetry', async () => {
    const cache = await syntheticCache();
    const fake = protocolFetch({ tools: [{ name: 'plan_call', inputSchema: { type: 'object' } }] });
    const discovery = createCalleDiscovery({ enabled: true, cacheRoot: cache.root, fetchImpl: fake });
    await expect(discovery.listTools()).resolves.toEqual({ tools: [{ name: 'plan_call', inputSchema: { type: 'object' } }] });
    await expect(discovery.listTools()).rejects.toThrow('OPERATION_ALREADY_USED');
    expect(fake.mock.calls.map(([url, init]) => [url, (JSON.parse(init?.body as string) as { method: string }).method])).toEqual([
      [PINNED_CALLE_URL, 'initialize'], [PINNED_CALLE_URL, 'notifications/initialized'], [PINNED_CALLE_URL, 'tools/list'],
    ]);
    expect((fake.mock.calls[1]?.[1]?.headers as Record<string, string>)['mcp-session-id']).toBe('SYNTHETIC_SESSION');
    expect(await readFile(cache.token, 'utf8')).toBe(cache.before);
    expect(await readdir(dirname(cache.token))).toEqual(['token.json']);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it.each([401, 403])('stops on %i without deleting the synthetic cache, login or retry', async (status) => {
    const cache = await syntheticCache();
    const fake = vi.fn<typeof fetch>(() => Promise.resolve(new Response(SYNTHETIC_TOKEN, { status })));
    const discovery = createCalleDiscovery({ enabled: true, cacheRoot: cache.root, fetchImpl: fake });
    await expect(discovery.listTools()).rejects.toMatchObject({ code: 'AUTH_REJECTED', message: 'AUTH_REJECTED' });
    await expect(discovery.listTools()).rejects.toThrow('OPERATION_ALREADY_USED');
    expect(fake).toHaveBeenCalledTimes(1);
    expect(await readFile(cache.token, 'utf8')).toBe(cache.before);
    expect(await readdir(dirname(cache.token))).toEqual(['token.json']);
  });
  it.each([0, 1])('does not dispatch the selected operation when handshake phase %i fails', async (failedPhase) => {
    const cache = await syntheticCache();
    let call = 0;
    const normal = protocolFetch();
    const fake = vi.fn<typeof fetch>((url, init) => call++ === failedPhase ? Promise.resolve(new Response(null, { status: 503 })) : normal(url, init));
    const session = createCalleCoreSession({ enabled: true, cacheRoot: cache.root, fetchImpl: fake });
    await expect(session.runCall(capability, new AbortController().signal)).resolves.toMatchObject({ kind: 'REJECTED_BEFORE_DISPATCH', reasonCode: 'HTTP_RESPONSE_REFUSED' });
    expect(session.observations().run.mutationAttempted).toBe(false);
    expect(fake).toHaveBeenCalledTimes(failedPhase + 1);
  });
  it('treats a pre-aborted operation as definitely not dispatched', async () => {
    const cache = await syntheticCache();
    const fake = protocolFetch();
    const session = createCalleCoreSession({ enabled: true, cacheRoot: cache.root, fetchImpl: fake });
    await expect(session.runCall(capability, AbortSignal.abort())).resolves.toMatchObject({ kind: 'REJECTED_BEFORE_DISPATCH', reasonCode: 'ABORTED' });
    expect(fake).not.toHaveBeenCalled();
  });
  it('keeps a lost mutation response uncertain and never makes a second attempt', async () => {
    const cache = await syntheticCache();
    const normal = protocolFetch();
    const fake = vi.fn<typeof fetch>((url, init) => (JSON.parse(init?.body as string) as { method: string }).method === 'tools/call' ? Promise.reject(new Error(SYNTHETIC_TOKEN)) : normal(url, init));
    const session = createCalleCoreSession({ enabled: true, cacheRoot: cache.root, fetchImpl: fake });
    for (let index = 0; index < 2; index += 1) await expect(session.runCall(capability, new AbortController().signal)).resolves.toEqual({ kind: 'DISPATCH_OUTCOME_UNKNOWN' });
    expect(session.observations().run).toMatchObject({ attemptedRequests: 3, mutationAttempted: true });
    expect(fake).toHaveBeenCalledTimes(3);
  });
  it('keeps an aborted mutation body read uncertain with no second mutation', async () => {
    const cache = await syntheticCache();
    const normal = protocolFetch();
    const response = new Response(new ReadableStream<Uint8Array>());
    const controller = new AbortController();
    const fake = vi.fn<typeof fetch>((url, init) => (JSON.parse(init?.body as string) as { method: string }).method === 'tools/call' ? Promise.resolve(response) : normal(url, init));
    const session = createCalleCoreSession({ enabled: true, cacheRoot: cache.root, fetchImpl: fake });
    const pending = session.runCall(capability, controller.signal);
    await vi.waitFor(() => expect(response.body?.locked).toBe(true));
    controller.abort();
    await expect(pending).resolves.toEqual({ kind: 'DISPATCH_OUTCOME_UNKNOWN' });
    await expect(session.runCall(capability, new AbortController().signal)).resolves.toEqual({ kind: 'DISPATCH_OUTCOME_UNKNOWN' });
    expect(fake).toHaveBeenCalledTimes(3);
    expect(fake.mock.calls[2]?.[1]?.signal?.aborted).toBe(true);
  });
  it('distinguishes a failed read-only discovery from a mutation attempt', async () => {
    const cache = await syntheticCache();
    const normal = protocolFetch();
    const fake = vi.fn<typeof fetch>((url, init) => (JSON.parse(init?.body as string) as { method: string }).method === 'tools/list' ? Promise.reject(new Error(SYNTHETIC_TOKEN)) : normal(url, init));
    const discovery = createCalleDiscovery({ enabled: true, cacheRoot: cache.root, fetchImpl: fake });
    await expect(discovery.listTools()).rejects.toThrow('NETWORK_FAILED');
    expect(discovery.observation()).toMatchObject({ selectedOperationDispatched: true, mutationAttempted: false, attemptedRequests: 3 });
  });
  it('returns a bounded successful run envelope while keeping raw values inside the backend', async () => {
    const cache = await syntheticCache();
    const body = { structuredContent: { run_id: 'SYNTHETIC_R3_RUN', state: 'QUEUED' } };
    const fake = protocolFetch(body);
    const session = createCalleCoreSession({ enabled: true, cacheRoot: cache.root, fetchImpl: fake });
    await expect(session.runCall(capability, new AbortController().signal)).resolves.toMatchObject({ kind: 'DISPATCHED_RESPONSE', response: { body } });
    expect(JSON.stringify(session.observations())).not.toMatch(/SYNTHETIC|Bearer|token/iu);
    expect(session.observations().run.attemptedRequests).toBe(3);
  });
  it('composes the Core session with the existing fixed transport for ambiguous run responses', async () => {
    const cache = await syntheticCache();
    const fake = protocolFetch({ unexpected: 'SYNTHETIC_OPAQUE_VALUE' });
    const session = createCalleCoreSession({ enabled: true, cacheRoot: cache.root, fetchImpl: fake });
    const authentication: CalleBackendAuthenticationBoundary = { withAuthenticatedSession: (_request, operation) => operation(session) };
    const transport = new FixedCalleMcpTransport({ ...DISABLED_CALLE_LIVE_TRANSPORT_POLICY, enabled: true }, authentication);
    await expect(transport.runCall(capability)).rejects.toMatchObject({ code: 'REMOTE_EXECUTION_UNCERTAIN' });
    await expect(transport.runCall(capability)).rejects.toMatchObject({ code: 'REMOTE_EXECUTION_UNCERTAIN' });
    expect(fake).toHaveBeenCalledTimes(3);
  });
  it('retains typed plan/run/status methods while snapshotting a plan before async dispatch', async () => {
    const cache = await syntheticCache();
    const fake = protocolFetch({ structuredContent: { run_id: 'SYNTHETIC_R3_RUN', state: 'QUEUED' } });
    const session = createCalleCoreSession({ enabled: true, cacheRoot: cache.root, fetchImpl: fake });
    const payload = { goal: 'Synthetic original brief' };
    const pending = session.planCall(payload, new AbortController().signal);
    payload.goal = 'Changed after invocation';
    await pending;
    const planWire = JSON.parse(fake.mock.calls[2]?.[1]?.body as string) as { params: { name: string; arguments: { goal: string } } };
    expect(planWire.params).toMatchObject({ name: 'plan_call', arguments: { goal: 'Synthetic original brief' } });
    await session.getCallRun(asCalleRunId('SYNTHETIC_R3_RUN'), new AbortController().signal);
    expect((JSON.parse(fake.mock.calls[5]?.[1]?.body as string) as { params: { name: string } }).params.name).toBe('get_call_run');
    expect(Object.keys(session).sort()).toEqual(['getCallRun', 'observations', 'planCall', 'runCall']);
  });
  it('limits status observations to three reads of the same run while plan and run remain single-use', async () => {
    const cache = await syntheticCache();
    const fake = protocolFetch({ structuredContent: { run_id: 'SYNTHETIC_R3_RUN', status: 'IN_PROGRESS' } });
    const session = createCalleCoreSession({ enabled: true, cacheRoot: cache.root, fetchImpl: fake });
    const runId = asCalleRunId('SYNTHETIC_R3_RUN');
    await session.planCall({ goal: 'Fictitious one-time plan.' }, new AbortController().signal);
    await session.runCall(capability, new AbortController().signal);
    await session.getCallRun(runId, new AbortController().signal);
    await expect(session.getCallRun(asCalleRunId('SYNTHETIC_DIFFERENT_RUN'), new AbortController().signal))
      .rejects.toThrow('STATUS_RUN_ID_MISMATCH');
    await session.getCallRun(runId, new AbortController().signal);
    await session.getCallRun(runId, new AbortController().signal);
    await expect(session.getCallRun(runId, new AbortController().signal)).rejects.toThrow('STATUS_READ_LIMIT_REACHED');
    await expect(session.planCall({ goal: 'Fictitious forbidden retry.' }, new AbortController().signal))
      .rejects.toThrow('OPERATION_ALREADY_USED');
    await session.runCall(capability, new AbortController().signal);
    expect(fake).toHaveBeenCalledTimes(15);
    expect(session.observations()).toMatchObject({ statusReadCount: 3, status: { attemptedRequests: 9, mutationAttempted: false } });
    expect(JSON.stringify(session.observations())).not.toMatch(/SYNTHETIC/u);
    expect(await readFile(cache.token, 'utf8')).toBe(cache.before);
  });

  it('consumes a status slot on failure and never dispatches a fourth read', async () => {
    const cache = await syntheticCache();
    const fake = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 401 })));
    const session = createCalleCoreSession({ enabled: true, cacheRoot: cache.root, fetchImpl: fake });
    for (let index = 0; index < 3; index += 1) {
      await expect(session.getCallRun(asCalleRunId('SYNTHETIC_R3_RUN'), new AbortController().signal))
        .rejects.toThrow('AUTH_REJECTED');
    }
    await expect(session.getCallRun(asCalleRunId('SYNTHETIC_R3_RUN'), new AbortController().signal))
      .rejects.toThrow('STATUS_READ_LIMIT_REACHED');
    expect(fake).toHaveBeenCalledTimes(3);
    expect(session.observations()).toMatchObject({ statusReadCount: 3, status: { attemptedRequests: 3, mutationAttempted: false } });
  });

  it('rejects overlapping status reads without creating another observation', async () => {
    const cache = await syntheticCache();
    const fake = protocolFetch({ structuredContent: { status: 'IN_PROGRESS' } });
    const session = createCalleCoreSession({ enabled: true, cacheRoot: cache.root, fetchImpl: fake });
    const first = session.getCallRun(asCalleRunId('SYNTHETIC_R3_RUN'), new AbortController().signal);
    await expect(session.getCallRun(asCalleRunId('SYNTHETIC_R3_RUN'), new AbortController().signal))
      .rejects.toThrow('STATUS_READ_IN_FLIGHT');
    await first;
    expect(fake).toHaveBeenCalledTimes(3);
    expect(session.observations()).toMatchObject({ statusReadCount: 1 });
  });

  it.each(['legacy-flat', 'observed-nested'] as const)('composes the workshop through a synthetic %s terminal result', async (shape) => {
    const cache = await syntheticCache();
    const sessionId = 'synthetic-workshop-composition';
    const checkpointRoot = join(cache.root, 'run-checkpoints');
    const checkpoints = new FileCalleRunCheckpointStore(checkpointRoot, resolve(process.cwd()));
    const tools: string[] = [];
    let statusReads = 0;
    const transcript = [
      'Supplier: Part arrival is estimated for 2026-09-18.',
      'Supplier: Repair completion is not confirmed.',
      'Supplier: Device return is not confirmed.',
    ];
    const fake = vi.fn<typeof fetch>(async (_url, init) => {
      const wire = JSON.parse(init?.body as string) as { method: string; id: string; params?: { name: string } };
      if (wire.method === 'initialize') return initializeResponse();
      if (wire.method === 'notifications/initialized') return new Response(null, { status: 202 });
      const name = wire.params?.name;
      if (name === 'plan_call') {
        tools.push(name);
        return jsonResponse(wire.id, { structuredContent: { ready_to_run: true, plan_id: 'SYNTHETIC_CHAIN_PLAN', confirm_token: 'SYNTHETIC_CHAIN_CONFIRM', next_step: 'Review the fictional plan.', confirm_summary: 'One fictional workshop follow-up.' } });
      }
      if (name === 'run_call') {
        // The durable intent must exist before the Core can dispatch a mutation.
        expect(await checkpoints.load(sessionId)).toMatchObject({ phase: 'RUN_REQUESTED', runId: null });
        tools.push(name);
        return jsonResponse(wire.id, { structuredContent: { run_id: 'SYNTHETIC_CHAIN_RUN', status: 'QUEUED' } });
      }
      if (name === 'get_call_run') {
        expect(await checkpoints.load(sessionId)).toMatchObject({ phase: 'RUN_ID_RECEIVED', runId: 'SYNTHETIC_CHAIN_RUN' });
        tools.push(name);
        statusReads += 1;
        const payload = shape === 'legacy-flat'
          ? { status: 'COMPLETED', transcript, summary: 'Synthetic supplier follow-up only.' }
          : { run_id: 'SYNTHETIC_CHAIN_RUN', status: statusReads < 3 ? 'IN_PROGRESS' : 'COMPLETED', activity: [],
            result: { transcript: statusReads < 3 ? null : transcript.join('\n'), post_summary: null, summary: 'Synthetic supplier follow-up only.' },
            next_step: { action: statusReads < 3 ? 'poll_get_call_run' : 'report_result', instruction: 'Fictitious informational status.' } };
        return jsonResponse(wire.id, { structuredContent: payload });
      }
      throw new Error('An unexpected tool reached the synthetic HTTP server.');
    });
    const core = createCalleCoreSession({ enabled: true, cacheRoot: cache.root, fetchImpl: fake });
    const authentication: CalleBackendAuthenticationBoundary = { withAuthenticatedSession: (_request, operation) => operation(core) };
    const transport = new FixedCalleMcpTransport({ ...DISABLED_CALLE_LIVE_TRANSPORT_POLICY, enabled: true }, authentication);
    let tick = 0;
    const clock = { now: () => new Date(Date.UTC(2026, 8, 12, 12, 0, tick++)).toISOString() };
    const adapter = new CalleLiveAdapter(sessionId, transport, checkpoints, clock);
    const plan: CallPlan = {
      id: 'synthetic-workshop-review', caseId: 'case-demo-repair-0042',
      objectiveSummary: 'Clarify the synthetic repair dates separately.',
      proposedScript: ['Identify this as an automated fictional workshop follow-up.'],
      plannedQuestions: ['When does the part arrive?', 'Is repair completion confirmed?', 'Is device return confirmed?'],
      transmittedData: ['Synthetic repair reference: DEMO-REPAIR-0042', 'Demo espresso machine'],
      prohibitedBehaviors: ['No payment or external commitment.'],
      stopConditions: ['Stop if real personal information is requested.'],
      riskEstimate: 'MEDIUM', provider: 'CALLE', createdAt: clock.now(),
    };
    await adapter.preparePlan({ reviewPlan: plan, payload: { to_phones: null, goal: 'Fictional repair date follow-up. No real destination.' } });
    expect(tools).toEqual(['plan_call']);
    await expect(adapter.startRun()).rejects.toMatchObject({ code: 'RUN_GATE_CLOSED' });
    expect(tools).toEqual(['plan_call']);
    adapter.beginApprovalReview();
    await adapter.approve({ decision: 'APPROVED', decidedAt: clock.now(), planFingerprint: await fingerprintPlan(plan), confirmedTransmittedData: [...plan.transmittedData], comment: null });
    await adapter.startRun();
    expect(await checkpoints.load(sessionId)).toMatchObject({ phase: 'RUN_ID_RECEIVED', runId: 'SYNTHETIC_CHAIN_RUN' });
    await expect(adapter.startRun()).rejects.toMatchObject({ code: 'RUN_GATE_CLOSED' });
    let elapsed = 0;
    const view = await adapter.pollUntilTerminal(
      { initialDelayMs: 0, intervalMs: 1, timeoutMs: 100, maxPolls: shape === 'legacy-flat' ? 1 : 3 },
      { nowMs: () => elapsed, wait: (ms) => { elapsed += ms; return Promise.resolve(); } },
    );
    expect(view).toMatchObject({ state: 'COMPLETED', gateState: 'CONSUMED', capabilityPresent: false, checkpointPhase: 'TERMINAL', transcript });
    expect(JSON.stringify(view)).not.toMatch(/SYNTHETIC_CHAIN_(?:PLAN|CONFIRM|RUN)|SYNTHETIC_R3_CREDENTIAL/u);
    const outcome = interpretWorkshopTranscript(view.transcript, 'COMPLETED', {
      customerExpectedReturn: '2026-09-18', observation: { observedAt: '2026-09-12T12:00:00.000Z', timeZone: 'Europe/Paris' },
    });
    expect(outcome.dates.PART_ARRIVAL).toMatchObject({ qualification: 'ESTIMATED', date: '2026-09-18' });
    expect(outcome.dates.DEVICE_RETURN).toMatchObject({ qualification: 'UNKNOWN', date: null });
    expect(outcome.expectation).toBe('UNCONFIRMED');
    expect(outcome.draft.some((sentence) => sentence.text.includes('not yet have a confirmed date'))).toBe(true);
    const restarted = new CalleLiveAdapter(sessionId, transport, new FileCalleRunCheckpointStore(checkpointRoot, resolve(process.cwd())), clock);
    expect(await restarted.restoreCheckpoint()).toMatchObject({ state: 'COMPLETED', checkpointPhase: 'TERMINAL' });
    await expect(restarted.startRun()).rejects.toMatchObject({ code: 'RUN_GATE_CLOSED' });
    expect(tools).toEqual(['plan_call', 'run_call', ...Array<string>(shape === 'legacy-flat' ? 1 : 3).fill('get_call_run')]);
    expect(fake).toHaveBeenCalledTimes(shape === 'legacy-flat' ? 9 : 15);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(await readFile(cache.token, 'utf8')).toBe(cache.before);
  });
  it('uses byte-identical pinned Core modules and keeps the guarded runtime outside the public entry point', async () => {
    const core = JSON.parse(await readFile('docs/public/calle-runtime-pins.json', 'utf8')) as { package: string; version: string; files: { path: string; sha256: string }[] };
    expect(core.package).toBe('@call-e/core');
    expect(core.version).toBe('0.2.3');
    for (const name of ['lib/mcp-client.js', 'lib/cache.js', 'lib/constants.js']) {
      const expected = core?.files.find((item) => item.path.replaceAll('\\', '/') === name);
      const bytes = await readFile(join('tools/calle-cli/node_modules/@call-e/core', name));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(expected?.sha256.toLowerCase());
    }
    const facade = await readFile('tools/calle-cli/guarded-calle-core.mjs', 'utf8');
    expect(facade).toContain("from './node_modules/@call-e/core/lib/mcp-client.js'");
    expect(facade).not.toMatch(/broker-client|removeTokenCache|loginWithBroker|console\.|process\.stdout|writeFile/u);
    expect(await readFile('src/main.ts', 'utf8')).not.toMatch(/guarded-calle-core|guarded-mcp-fetch/u);
  });
});
