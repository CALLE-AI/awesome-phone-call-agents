// Backend-internal HTTP guard for the existing, pinned CALL-E Core.
// The protocol is closed: initialize, initialized, one selected operation.
export const PINNED_CALLE_URL = 'https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth';
export const CALLE_PROTOCOL_VERSION = '2025-11-25';
export const CALLE_HTTP_LIMITS = Object.freeze({
  timeoutMs: 15_000, perRequestTimeoutMs: 10_000,
  maximumRequestBytes: 32_768, maximumResponseBytes: 1_048_576,
});
const OPERATIONS = new Set(['tools/list', 'plan_call', 'run_call', 'get_call_run']);
const HEADERS = new Set(['authorization', 'content-type', 'accept', 'mcp-protocol-version', 'mcp-session-id']);
const ERROR_CODES = new Set([
  'NETWORK_POLICY_VIOLATION', 'PROTOCOL_REQUEST_INVALID', 'PROTOCOL_RESPONSE_INVALID',
  'PROTOCOL_INITIALIZATION_FAILED', 'OPERATION_TIMEOUT', 'REQUEST_TIMEOUT',
  'REQUEST_BUDGET_EXCEEDED', 'REQUEST_TOO_LARGE', 'RESPONSE_TOO_LARGE',
  'REDIRECT_REFUSED', 'AUTH_REJECTED', 'AUTH_UNAVAILABLE', 'HTTP_RESPONSE_REFUSED',
  'ABORTED', 'NETWORK_FAILED', 'OPERATION_CLOSED', 'OPERATION_ALREADY_USED',
  'DISCOVERY_OR_SESSION_DISABLED', 'CACHE_LOCATION_REQUIRED',
  'STATUS_RUN_ID_MISMATCH', 'STATUS_READ_IN_FLIGHT', 'STATUS_READ_LIMIT_REACHED',
]);

export class CalleHttpBoundaryError extends Error {
  constructor(code) {
    const safeCode = ERROR_CODES.has(code) ? code : 'NETWORK_FAILED';
    super(safeCode);
    this.name = 'CalleHttpBoundaryError';
    this.code = safeCode;
  }
}
const failure = (code) => new CalleHttpBoundaryError(code);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keysAre = (value, keys) => record(value) && Object.keys(value).every((key) => keys.includes(key));

export function assertPinnedCalleUrl(value) {
  if (typeof value !== 'string' || value !== PINNED_CALLE_URL) throw failure('NETWORK_POLICY_VIOLATION');
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'seleven-mcp-sg.airudder.com'
    || parsed.port !== '' || parsed.pathname !== '/mcp/openagent_oauth'
    || parsed.search || parsed.hash || parsed.username || parsed.password) throw failure('NETWORK_POLICY_VIOLATION');
}

function validateHeaders(value) {
  if (!record(value)) throw failure('NETWORK_POLICY_VIOLATION');
  const headers = {};
  let bytes = 0;
  for (const [key, text] of Object.entries(value)) {
    const name = key.toLowerCase();
    if (!HEADERS.has(name) || Object.hasOwn(headers, name) || typeof text !== 'string'
      || !/^[\x20-\x7e]+$/u.test(text)) throw failure('NETWORK_POLICY_VIOLATION');
    bytes += Buffer.byteLength(key + text, 'utf8');
    if (bytes > 12_288) throw failure('NETWORK_POLICY_VIOLATION');
    headers[name] = text;
  }
  if (headers['content-type'] !== 'application/json'
    || headers.accept !== 'application/json, text/event-stream'
    || headers['mcp-protocol-version'] !== CALLE_PROTOCOL_VERSION
    || !/^Bearer [\x21-\x7e]{1,8192}$/u.test(headers.authorization ?? '')
    || (headers['mcp-session-id'] !== undefined && !/^[\x21-\x7e]{1,512}$/u.test(headers['mcp-session-id']))) throw failure('NETWORK_POLICY_VIOLATION');
  return headers;
}

function validatePayload(payload, phase, selected) {
  if (!keysAre(payload, ['jsonrpc', 'id', 'method', 'params']) || payload.jsonrpc !== '2.0') throw failure('PROTOCOL_REQUEST_INVALID');
  if (phase === 0) {
    if (payload.id !== 'calle-initialize' || payload.method !== 'initialize'
      || !keysAre(payload.params, ['protocolVersion', 'capabilities', 'clientInfo'])
      || payload.params.protocolVersion !== CALLE_PROTOCOL_VERSION
      || !record(payload.params.capabilities) || Object.keys(payload.params.capabilities).length !== 0
      || !keysAre(payload.params.clientInfo, ['name', 'version'])
      || payload.params.clientInfo.name !== 'callops' || payload.params.clientInfo.version !== '0.1.0') throw failure('PROTOCOL_REQUEST_INVALID');
  } else if (phase === 1) {
    if (Object.hasOwn(payload, 'id') || payload.method !== 'notifications/initialized'
      || !record(payload.params) || Object.keys(payload.params).length !== 0) throw failure('PROTOCOL_REQUEST_INVALID');
  } else if (selected === 'tools/list') {
    if (payload.id !== 'calle-tools-list' || payload.method !== 'tools/list'
      || !record(payload.params) || Object.keys(payload.params).length !== 0) throw failure('PROTOCOL_REQUEST_INVALID');
  } else if (payload.id !== `calle-${selected}` || payload.method !== 'tools/call'
    || !keysAre(payload.params, ['name', 'arguments']) || payload.params.name !== selected
    || !record(payload.params.arguments)) throw failure('PROTOCOL_REQUEST_INVALID');
}

function validateResponse(bytes, phase, selected) {
  if (phase === 1 && bytes.byteLength === 0) return;
  if (phase === 1) throw failure('PROTOCOL_RESPONSE_INVALID');
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw failure('PROTOCOL_RESPONSE_INVALID'); }
  const id = phase === 0 ? 'calle-initialize' : selected === 'tools/list' ? 'calle-tools-list' : `calle-${selected}`;
  if (!record(body) || body.jsonrpc !== '2.0' || body.id !== id || Object.hasOwn(body, 'error')
    || !record(body.result) || body.result.isError === true) throw failure('PROTOCOL_RESPONSE_INVALID');
  if (phase === 0 && (body.result.protocolVersion !== CALLE_PROTOCOL_VERSION
    || !record(body.result.capabilities) || !record(body.result.serverInfo))) throw failure('PROTOCOL_INITIALIZATION_FAILED');
  if (phase === 2 && selected === 'tools/list' && !Array.isArray(body.result.tools)) throw failure('PROTOCOL_RESPONSE_INVALID');
}

/** Internal primitive. No arbitrary endpoint, sequence, tool or callback dispatch. */
export function createBoundedCalleFetch(selected, fetchImpl, options = {}) {
  if (!OPERATIONS.has(selected) || typeof fetchImpl !== 'function') throw failure('NETWORK_POLICY_VIOLATION');
  const limits = { ...CALLE_HTTP_LIMITS, ...options.limits };
  if (Object.keys(limits).some((key) => !Object.hasOwn(CALLE_HTTP_LIMITS, key))
    || Object.entries(limits).some(([key, value]) => !Number.isSafeInteger(value) || value < 1 || value > CALLE_HTTP_LIMITS[key])) throw failure('NETWORK_POLICY_VIOLATION');
  const controller = new AbortController();
  const deadline = performance.now() + limits.timeoutMs;
  const timer = setTimeout(() => controller.abort(failure('OPERATION_TIMEOUT')), limits.timeoutMs);
  let phase = 0;
  let active = false;
  let terminalCode = null;
  let attemptedRequests = 0;
  let requestBytes = 0;
  let responseBytes = 0;
  let selectedOperationDispatched = false;
  let mutationAttempted = false;
  const observation = () => Object.freeze({ attemptedRequests, requestBytes, responseBytes, selectedOperationDispatched, mutationAttempted });
  const stop = (code) => {
    terminalCode ??= code;
    controller.abort(failure(terminalCode));
    clearTimeout(timer);
    return failure(terminalCode);
  };
  const fetch = async (url, init) => {
    if (terminalCode !== null) throw failure(terminalCode);
    if (phase >= 3 || attemptedRequests >= 3 || active) throw stop('REQUEST_BUDGET_EXCEEDED');
    let requestTimer;
    let signal;
    let onAbort;
    let reader;
    try {
      assertPinnedCalleUrl(url);
      if (!record(init) || init.method !== 'POST' || typeof init.body !== 'string'
        || Object.keys(init).some((key) => !['method', 'headers', 'body', 'signal'].includes(key))) throw failure('NETWORK_POLICY_VIOLATION');
      const headers = validateHeaders(init.headers);
      const bytes = Buffer.byteLength(init.body, 'utf8');
      if (bytes > limits.maximumRequestBytes - requestBytes) throw failure('REQUEST_TOO_LARGE');
      let payload;
      try { payload = JSON.parse(init.body); } catch { throw failure('PROTOCOL_REQUEST_INVALID'); }
      validatePayload(payload, phase, selected);
      const requestController = new AbortController();
      requestTimer = setTimeout(() => requestController.abort(failure('REQUEST_TIMEOUT')), limits.perRequestTimeoutMs);
      signal = AbortSignal.any([controller.signal, requestController.signal, init.signal, options.signal].filter((item) => item !== undefined));
      const abortError = () => signal.reason instanceof CalleHttpBoundaryError ? signal.reason : failure('ABORTED');
      if (signal.aborted) throw abortError();
      const aborted = new Promise((_, reject) => { onAbort = () => reject(abortError()); signal.addEventListener('abort', onAbort, { once: true }); });
      active = true;
      attemptedRequests += 1; // A failed attempt also consumes this slot.
      requestBytes += bytes;
      if (phase === 2) {
        selectedOperationDispatched = true;
        mutationAttempted = selected === 'run_call';
      }
      const response = await Promise.race([fetchImpl(PINNED_CALLE_URL, {
        method: 'POST', headers, body: init.body, signal, redirect: 'error', credentials: 'omit',
      }), aborted]);
      if (signal.aborted) throw abortError();
      if (response.redirected || (response.url && response.url !== PINNED_CALLE_URL)) throw failure('NETWORK_POLICY_VIOLATION');
      if (response.status >= 300 && response.status < 400) throw failure('REDIRECT_REFUSED');
      if (response.status === 401 || response.status === 403) throw failure('AUTH_REJECTED');
      if (!response.ok) throw failure('HTTP_RESPONSE_REFUSED');
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/u.test(length) || !Number.isSafeInteger(Number(length)))) throw failure('PROTOCOL_RESPONSE_INVALID');
      if (length !== null && Number(length) > limits.maximumResponseBytes - responseBytes) throw failure('RESPONSE_TOO_LARGE');
      const sessionId = response.headers.get('mcp-session-id');
      if (sessionId !== null && !/^[\x21-\x7e]{1,512}$/u.test(sessionId)) throw failure('PROTOCOL_RESPONSE_INVALID');
      const chunks = [];
      let bodyBytes = 0;
      if (response.body !== null) {
        reader = response.body.getReader();
        while (true) {
          const item = await Promise.race([reader.read(), aborted]);
          if (item.done) break;
          if (!(item.value instanceof Uint8Array)) throw failure('PROTOCOL_RESPONSE_INVALID');
          responseBytes += item.value.byteLength;
          if (responseBytes > limits.maximumResponseBytes) throw failure('RESPONSE_TOO_LARGE');
          bodyBytes += item.value.byteLength;
          chunks.push(item.value);
        }
      }
      if (signal.aborted) throw abortError();
      const collected = new Uint8Array(bodyBytes);
      let offset = 0;
      for (const chunk of chunks) { collected.set(chunk, offset); offset += chunk.byteLength; }
      validateResponse(collected, phase, selected);
      const safeHeaders = { 'content-type': 'application/json' };
      if (sessionId !== null) safeHeaders['mcp-session-id'] = sessionId;
      phase += 1;
      return new Response(bodyBytes === 0 ? null : collected, { status: response.status, headers: safeHeaders });
    } catch (error) {
      const code = error instanceof CalleHttpBoundaryError ? error.code : signal?.aborted
        ? signal.reason instanceof CalleHttpBoundaryError ? signal.reason.code : 'ABORTED'
        : 'NETWORK_FAILED';
      throw stop(code);
    } finally {
      active = false;
      if (requestTimer !== undefined) clearTimeout(requestTimer);
      if (signal !== undefined && onAbort !== undefined) signal.removeEventListener('abort', onAbort);
      if (reader !== undefined) {
        if (terminalCode !== null) void reader.cancel().catch(() => undefined);
        try { reader.releaseLock(); } catch { /* An aborted pending read may still hold the lock. */ }
      }
    }
  };
  return Object.freeze({
    fetch, observation,
    assertComplete: () => {
      if (performance.now() >= deadline || controller.signal.reason?.code === 'OPERATION_TIMEOUT') throw stop('OPERATION_TIMEOUT');
      if (terminalCode !== null || controller.signal.aborted || options.signal?.aborted) throw stop(terminalCode ?? 'ABORTED');
      if (phase !== 3) throw stop('PROTOCOL_RESPONSE_INVALID');
    },
    close: () => { clearTimeout(timer); controller.abort(failure('ABORTED')); terminalCode ??= 'OPERATION_CLOSED'; },
  });
}
