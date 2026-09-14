import type {
  CalleAuthenticatedSessionRequest,
  CalleBackendAuthenticationBoundary,
  CalleMcpResponseEnvelope,
} from '../integrations/calle-live-auth-boundary';
import {
  CalleLiveAdapterError,
  CalleRemoteExecutionUncertainError,
  CalleRunRejectedBeforeExecutionError,
} from '../integrations/calle-live-errors';
import {
  classifyCalleGetCallRunResponse,
  classifyCalleRunCallResponse,
  safeRemoteReasonCode,
} from '../integrations/calle-live-response-contracts';
import {
  assertCalleLiveTransportPolicy,
  type CalleLiveTransportPolicy,
} from '../integrations/calle-live-transport-policy';
import type {
  CalleConfirmToken,
  CalleLivePlanRequest,
  CalleLiveToolName,
  CalleLiveTransport,
  CallePlanId,
  CalleRunId,
} from '../integrations/calle-live-types';

const PLAN_REQUEST_FIELDS = new Set([
  'plan_id',
  'to_phones',
  'region',
  'language',
  'goal',
  'scheduled_at',
  'retry_confirmation_action',
  'user_input',
  'ttl_seconds',
]);

const RETRY_ACTIONS = new Set([
  'confirm_suggested_time',
  'retry_now',
  'set_custom_time',
]);

export interface CalleTransportLogEvent {
  readonly event:
    | 'TRANSPORT_DISABLED'
    | 'REQUEST_ACCEPTED'
    | 'RESPONSE_ACCEPTED'
    | 'RESPONSE_REFUSED'
    | 'REQUEST_TIMEOUT';
  readonly tool: CalleLiveToolName;
  readonly detailCode: string;
}

export interface CalleTransportLogger {
  record(event: CalleTransportLogEvent): void;
}

const NOOP_LOGGER: CalleTransportLogger = Object.freeze({ record: () => undefined });

class TransportTimeoutError extends Error {}

function fail(message: string, code: string): never {
  throw new CalleLiveAdapterError(message, code);
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function assertPlanRequest(payload: CalleLivePlanRequest): void {
  const record = recordOf(payload);
  if (record === null) fail('The CALL-E planning request must be an object.', 'CALLE_PLAN_REQUEST_INVALID');
  if (Object.keys(record).some((key) => !PLAN_REQUEST_FIELDS.has(key))) {
    fail('The CALL-E planning request contains an unsupported field.', 'CALLE_PLAN_REQUEST_SCHEMA_DRIFT');
  }
  for (const key of ['plan_id', 'region', 'language', 'goal', 'scheduled_at', 'user_input']) {
    if (Object.hasOwn(record, key) && !nullableString(record[key])) {
      fail('A CALL-E planning text field has an invalid type.', 'CALLE_PLAN_REQUEST_TYPE_INVALID');
    }
  }
  if (Object.hasOwn(record, 'to_phones')) {
    const value = record.to_phones;
    if (
      value !== null &&
      (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim().length === 0))
    ) {
      fail('The CALL-E planning destination field has an invalid type.', 'CALLE_PLAN_DESTINATION_INVALID');
    }
  }
  if (
    Object.hasOwn(record, 'retry_confirmation_action') &&
    record.retry_confirmation_action !== null &&
    (typeof record.retry_confirmation_action !== 'string' ||
      !RETRY_ACTIONS.has(record.retry_confirmation_action))
  ) {
    fail('The CALL-E retry action is outside the observed input schema.', 'CALLE_PLAN_RETRY_ACTION_INVALID');
  }
  if (
    Object.hasOwn(record, 'ttl_seconds') &&
    record.ttl_seconds !== null &&
    (!Number.isSafeInteger(record.ttl_seconds) || (record.ttl_seconds as number) < 0)
  ) {
    fail('The CALL-E planning TTL is outside the observed input schema.', 'CALLE_PLAN_TTL_INVALID');
  }
}

function requestBytes(value: unknown): number {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail('The CALL-E request cannot be serialized safely.', 'CALLE_REQUEST_NOT_JSON');
  }
  return new TextEncoder().encode(serialized).byteLength;
}

function assertRequestSize(value: unknown, maximumBytes: number): void {
  if (requestBytes(value) > maximumBytes) {
    fail('The CALL-E request exceeds the local size bound.', 'CALLE_REQUEST_TOO_LARGE');
  }
}

function assertResponseEnvelope(
  envelope: CalleMcpResponseEnvelope,
  maximumBytes: number,
): CalleMcpResponseEnvelope {
  if (
    !Number.isSafeInteger(envelope.encodedBytes) ||
    envelope.encodedBytes < 0 ||
    envelope.encodedBytes > maximumBytes
  ) {
    fail('The CALL-E response was refused by the local size boundary.', 'CALLE_RESPONSE_SIZE_REFUSED');
  }
  return envelope;
}

async function bounded<TResult>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<TResult>,
): Promise<TResult> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutResult = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new TransportTimeoutError());
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), timeoutResult]);
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}

function destroyKnownRunFields(value: unknown): void {
  const root = recordOf(value);
  if (root === null) return;
  const records = new Set<Record<string, unknown>>([root]);
  const camel = recordOf(root.structuredContent);
  const snake = recordOf(root.structured_content);
  if (camel !== null) records.add(camel);
  if (snake !== null) records.add(snake);
  for (const record of [...records]) {
    const nested = recordOf(record.result);
    if (nested !== null) records.add(nested);
  }
  for (const record of records) {
    for (const key of ['run_id', 'cursor']) {
      if (Object.hasOwn(record, key)) Reflect.deleteProperty(record, key);
    }
  }
}

export class FixedCalleMcpTransport implements CalleLiveTransport {
  public constructor(
    private readonly policy: CalleLiveTransportPolicy,
    private readonly authentication: CalleBackendAuthenticationBoundary,
    private readonly logger: CalleTransportLogger = NOOP_LOGGER,
  ) {
    assertCalleLiveTransportPolicy(policy);
  }

  public async planCall(payload: CalleLivePlanRequest): Promise<unknown> {
    this.assertEnabled('plan_call');
    assertPlanRequest(payload);
    assertRequestSize(payload, this.policy.maximumRequestBytes);
    this.log('REQUEST_ACCEPTED', 'plan_call', 'STATIC_PLAN_OPERATION');
    let envelope: CalleMcpResponseEnvelope;
    try {
      envelope = await this.authentication.withAuthenticatedSession(
        this.sessionRequest(),
        (session) => bounded(this.policy.timeoutMs, (signal) => session.planCall(payload, signal)),
      );
    } catch (error) {
      if (error instanceof TransportTimeoutError) {
        this.log('REQUEST_TIMEOUT', 'plan_call', 'BOUNDED_TIMEOUT');
        fail('The CALL-E planning request reached its local timeout.', 'CALLE_PLAN_TIMEOUT');
      }
      this.log('RESPONSE_REFUSED', 'plan_call', 'SANITIZED_TRANSPORT_FAILURE');
      fail('The CALL-E planning transport failed without exposing remote data.', 'CALLE_PLAN_TRANSPORT_FAILED');
    }
    const accepted = assertResponseEnvelope(envelope, this.policy.maximumResponseBytes);
    this.log('RESPONSE_ACCEPTED', 'plan_call', 'BOUNDED_EPHEMERAL_RESPONSE');
    return accepted.body;
  }

  public async runCall(capability: {
    readonly planId: CallePlanId;
    readonly confirmToken: CalleConfirmToken;
  }): Promise<
    | {
        readonly kind: 'ACCEPTED';
        readonly runId: CalleRunId;
        readonly initialState: 'QUEUED' | 'IN_PROGRESS' | 'STATUS_UNKNOWN';
      }
    | { readonly kind: 'REJECTED_BEFORE_EXECUTION'; readonly reasonCode: string }
  > {
    this.assertEnabled('run_call');
    assertRequestSize(
      { plan_id: capability.planId, confirm_token: capability.confirmToken },
      this.policy.maximumRequestBytes,
    );
    this.log('REQUEST_ACCEPTED', 'run_call', 'STATIC_RUN_OPERATION');
    let outcome;
    try {
      outcome = await this.authentication.withAuthenticatedSession(
        this.sessionRequest(),
        (session) => bounded(this.policy.timeoutMs, (signal) => session.runCall(capability, signal)),
      );
    } catch (error) {
      this.log(
        error instanceof TransportTimeoutError ? 'REQUEST_TIMEOUT' : 'RESPONSE_REFUSED',
        'run_call',
        error instanceof TransportTimeoutError ? 'MUTATION_TIMEOUT' : 'MUTATION_OUTCOME_UNKNOWN',
      );
      throw new CalleRemoteExecutionUncertainError();
    }
    let body: unknown = null;
    try {
      if (outcome.kind === 'REJECTED_BEFORE_DISPATCH') {
        const reasonCode = safeRemoteReasonCode(outcome.reasonCode);
        this.log('RESPONSE_REFUSED', 'run_call', reasonCode);
        throw new CalleRunRejectedBeforeExecutionError(reasonCode);
      }
      if (outcome.kind === 'DISPATCH_OUTCOME_UNKNOWN') {
        this.log('RESPONSE_REFUSED', 'run_call', 'DISPATCH_OUTCOME_UNKNOWN');
        throw new CalleRemoteExecutionUncertainError();
      }
      const envelope = assertResponseEnvelope(outcome.response, this.policy.maximumResponseBytes);
      body = envelope.body;
      const classified = classifyCalleRunCallResponse(body);
      if (classified.kind !== 'RUN_ACCEPTED') {
        this.log('RESPONSE_REFUSED', 'run_call', classified.reason);
        throw new CalleRemoteExecutionUncertainError();
      }
      this.log('RESPONSE_ACCEPTED', 'run_call', 'RUN_ID_EPHEMERAL_BACKEND_ONLY');
      return Object.freeze({
        kind: 'ACCEPTED' as const,
        runId: classified.runIdHeldOnlyInBackendMemory,
        initialState: classified.initialState,
      });
    } catch (error) {
      if (
        error instanceof CalleRunRejectedBeforeExecutionError ||
        error instanceof CalleRemoteExecutionUncertainError
      ) {
        throw error;
      }
      this.log('RESPONSE_REFUSED', 'run_call', 'POST_DISPATCH_RESPONSE_REFUSED');
      throw new CalleRemoteExecutionUncertainError();
    } finally {
      destroyKnownRunFields(body);
    }
  }

  public async getCallRun(runId: CalleRunId) {
    this.assertEnabled('get_call_run');
    assertRequestSize({ run_id: runId }, this.policy.maximumRequestBytes);
    this.log('REQUEST_ACCEPTED', 'get_call_run', 'STATIC_STATUS_OPERATION');
    let envelope: CalleMcpResponseEnvelope;
    try {
      envelope = await this.authentication.withAuthenticatedSession(
        this.sessionRequest(),
        (session) => bounded(this.policy.timeoutMs, (signal) => session.getCallRun(runId, signal)),
      );
    } catch (error) {
      if (error instanceof TransportTimeoutError) {
        this.log('REQUEST_TIMEOUT', 'get_call_run', 'BOUNDED_TIMEOUT');
        fail('The CALL-E status request reached its local timeout.', 'CALLE_STATUS_TIMEOUT');
      }
      this.log('RESPONSE_REFUSED', 'get_call_run', 'SANITIZED_TRANSPORT_FAILURE');
      fail('The CALL-E status transport failed without exposing remote data.', 'CALLE_STATUS_TRANSPORT_FAILED');
    }
    let body: unknown = null;
    try {
      const accepted = assertResponseEnvelope(envelope, this.policy.maximumResponseBytes);
      body = accepted.body;
      const classified = classifyCalleGetCallRunResponse(body);
      if (classified.kind !== 'STATUS_OBSERVED') {
        this.log('RESPONSE_REFUSED', 'get_call_run', classified.reason);
        fail('The CALL-E status response did not match the prepared local contract.', 'CALLE_STATUS_SCHEMA_UNCONFIRMED');
      }
      this.log('RESPONSE_ACCEPTED', 'get_call_run', 'SANITIZED_STATUS_OBSERVED');
      return classified.normalized;
    } finally {
      destroyKnownRunFields(body);
    }
  }

  private assertEnabled(tool: CalleLiveToolName): void {
    if (!this.policy.enabled) {
      this.log('TRANSPORT_DISABLED', tool, 'EXPLICIT_BACKEND_ACTIVATION_REQUIRED');
      fail('The CALL-E live transport is disabled.', 'CALLE_LIVE_TRANSPORT_DISABLED');
    }
  }

  private sessionRequest(): CalleAuthenticatedSessionRequest {
    return Object.freeze({
      serviceUrl: this.policy.serviceUrl,
      timeoutMs: this.policy.timeoutMs,
      maximumResponseBytes: this.policy.maximumResponseBytes,
      telemetry: this.policy.telemetry,
      doNotTrack: this.policy.doNotTrack,
    });
  }

  private log(
    event: CalleTransportLogEvent['event'],
    tool: CalleLiveToolName,
    detailCode: string,
  ): void {
    this.logger.record(Object.freeze({ event, tool, detailCode: safeRemoteReasonCode(detailCode) }));
  }
}
