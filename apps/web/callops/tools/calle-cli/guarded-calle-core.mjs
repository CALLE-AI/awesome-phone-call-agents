import { isAbsolute } from 'node:path';
import { listMcpTools, callMcpTool, AuthRequiredError } from './node_modules/@call-e/core/lib/mcp-client.js';
import { CalleHttpBoundaryError, createBoundedCalleFetch, PINNED_CALLE_URL } from './guarded-mcp-fetch.mjs';

const EMPTY_OBSERVATION = Object.freeze({ attemptedRequests: 0, requestBytes: 0, responseBytes: 0, selectedOperationDispatched: false, mutationAttempted: false });
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const CALLE_MAX_STATUS_READS = 3;

function operation(selected, options) {
  let used = false;
  let observation = EMPTY_OBSERVATION;
  const invoke = async (argumentsValue, signal) => {
    if (options.enabled !== true) throw new CalleHttpBoundaryError('DISCOVERY_OR_SESSION_DISABLED');
    if (used) throw new CalleHttpBoundaryError('OPERATION_ALREADY_USED');
    used = true;
    if (typeof options.cacheRoot !== 'string' || !isAbsolute(options.cacheRoot)) throw new CalleHttpBoundaryError('CACHE_LOCATION_REQUIRED');
    // Snapshot inputs before the Core's first await; no caller can revise them in flight.
    let args;
    try {
      if (!record(argumentsValue)) throw new Error();
      const serialized = JSON.stringify(argumentsValue);
      if (Buffer.byteLength(serialized, 'utf8') > 32_768) throw new Error();
      args = JSON.parse(serialized);
    } catch { throw new CalleHttpBoundaryError('PROTOCOL_REQUEST_INVALID'); }
    const guard = createBoundedCalleFetch(selected, options.fetchImpl ?? globalThis.fetch, { signal, limits: options.limits });
    const config = Object.freeze({
      serverUrl: PINNED_CALLE_URL, cacheRoot: options.cacheRoot,
      timeoutSeconds: 15, minTtlSeconds: 300, mcpClientName: 'callops', mcpClientVersion: '0.1.0',
    });
    try {
      if (signal?.aborted) throw new CalleHttpBoundaryError('ABORTED');
      const body = selected === 'tools/list'
        ? await listMcpTools({ config, fetchImpl: guard.fetch })
        : await callMcpTool({ config, toolName: selected, toolArguments: args, fetchImpl: guard.fetch });
      guard.assertComplete();
      observation = guard.observation();
      return { body, encodedBytes: observation.responseBytes };
    } catch (error) {
      observation = guard.observation();
      const code = error instanceof CalleHttpBoundaryError ? error.code
        : error instanceof AuthRequiredError ? 'AUTH_UNAVAILABLE' : 'PROTOCOL_RESPONSE_INVALID';
      throw new CalleHttpBoundaryError(code);
    } finally { guard.close(); }
  };
  return { invoke, observation: () => observation };
}

/** R4 entry: discovery only, opt-in, one attempt, no auth fallback or cache writes. */
export function createCalleDiscovery(options = {}) {
  const selected = operation('tools/list', { ...options });
  return Object.freeze({
    listTools: async (signal) => (await selected.invoke({}, signal)).body,
    observation: selected.observation,
  });
}

/** Prepared private session. Not instantiated by any public or live entry point. */
export function createCalleCoreSession(options = {}) {
  const frozenOptions = { ...options };
  const plan = operation('plan_call', frozenOptions);
  const run = operation('run_call', frozenOptions);
  const statusOperations = [];
  let statusRunId = null;
  let statusReadInFlight = false;
  return Object.freeze({
    planCall: (payload, signal) => plan.invoke(payload, signal),
    runCall: async (capability, signal) => {
      try {
        if (!record(capability) || Object.keys(capability).some((key) => !['planId', 'confirmToken'].includes(key))
          || typeof capability.planId !== 'string' || !/^[\x21-\x7e]{1,512}$/u.test(capability.planId)
          || typeof capability.confirmToken !== 'string' || !/^[\x21-\x7e]{1,4096}$/u.test(capability.confirmToken)) throw new CalleHttpBoundaryError('PROTOCOL_REQUEST_INVALID');
        const response = await run.invoke({ plan_id: capability.planId, confirm_token: capability.confirmToken }, signal);
        return { kind: 'DISPATCHED_RESPONSE', response };
      } catch (error) {
        if (run.observation().mutationAttempted) return { kind: 'DISPATCH_OUTCOME_UNKNOWN' };
        return { kind: 'REJECTED_BEFORE_DISPATCH', reasonCode: error instanceof CalleHttpBoundaryError ? error.code : 'PROTOCOL_REQUEST_INVALID' };
      }
    },
    getCallRun: async (runId, signal) => {
      if (typeof runId !== 'string' || !/^[\x21-\x7e]{1,512}$/u.test(runId)) throw new CalleHttpBoundaryError('PROTOCOL_REQUEST_INVALID');
      if (statusRunId !== null && runId !== statusRunId) throw new CalleHttpBoundaryError('STATUS_RUN_ID_MISMATCH');
      if (statusReadInFlight) throw new CalleHttpBoundaryError('STATUS_READ_IN_FLIGHT');
      if (statusOperations.length >= CALLE_MAX_STATUS_READS) throw new CalleHttpBoundaryError('STATUS_READ_LIMIT_REACHED');
      // The adapter supplies the durable checkpoint's run id. Bind it on the first
      // observation and consume a slot before any await, including failed reads.
      statusRunId = runId;
      statusReadInFlight = true;
      const status = operation('get_call_run', frozenOptions);
      statusOperations.push(status);
      try { return await status.invoke({ run_id: runId }, signal); }
      finally { statusReadInFlight = false; }
    },
    observations: () => Object.freeze({
      plan: plan.observation(), run: run.observation(), statusReadCount: statusOperations.length,
      status: Object.freeze(statusOperations.reduce((total, status) => {
        const item = status.observation();
        return {
          attemptedRequests: total.attemptedRequests + item.attemptedRequests,
          requestBytes: total.requestBytes + item.requestBytes,
          responseBytes: total.responseBytes + item.responseBytes,
          selectedOperationDispatched: total.selectedOperationDispatched || item.selectedOperationDispatched,
          mutationAttempted: total.mutationAttempted || item.mutationAttempted,
        };
      }, EMPTY_OBSERVATION)),
    }),
  });
}
