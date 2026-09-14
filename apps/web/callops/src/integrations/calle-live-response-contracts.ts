import { asCalleRunId } from './calle-live-capability-vault';
import { sanitizeCallePlanText } from './calle-plan-response';
import type {
  JsonValueType,
  SanitizedOpaqueFieldObservation,
  SanitizedTextFieldObservation,
} from './calle-plan-response-types';
import type { CalleRunId, CalleRunStatusObservation } from './calle-live-types';

const SAFE_FIELD_NAME = /^[a-z][a-z0-9_]{0,63}$/u;
const SAFE_REASON_CODE = /^[A-Z][A-Z0-9_]{0,63}$/u;
const SENSITIVE_FIELD_NAME =
  /(?:authorization|bearer|cookie|credential|email|password|phone|secret|session|token)/iu;

const RUN_OUTPUT_FIELDS = new Set([
  'run_id',
  'status',
  'message',
  'error',
  'error_code',
]);

const STATUS_OUTPUT_FIELDS = new Set([
  'run_id',
  'status',
  'activity',
  'summary',
  'post_summary',
  'transcript',
  'next_step',
  'message',
  'error',
  'result',
]);

const EXECUTION_FIELDS = new Set(['status', 'run_id', 'activity']);
const BUSINESS_EVIDENCE_FIELDS = new Set(['summary', 'post_summary', 'transcript']);

const TERMINAL_FAILURE_STATES = new Set([
  'FAILED',
  'NO_ANSWER',
  'DECLINED',
  'CANCELED',
  'CANCELLED',
  'VOICEMAIL',
  'BUSY',
  'EXPIRED',
]);

export type CalleLiveStructuredPayloadPath =
  | 'result.structuredContent'
  | 'result.structured_content'
  | 'result'
  | 'result.structuredContent.result'
  | 'result.structured_content.result'
  | 'result.result';

export interface CalleSanitizedFieldType {
  readonly present: boolean;
  readonly type: JsonValueType;
}

export interface SanitizedCalleRunCallObservation {
  readonly structuredPayloadPath: CalleLiveStructuredPayloadPath | null;
  readonly runId: SanitizedOpaqueFieldObservation;
  readonly status: CalleSanitizedFieldType;
  readonly unexpectedFields: readonly string[];
}

export type CalleRunCallContractResult =
  | {
      readonly kind: 'RUN_ACCEPTED';
      readonly observation: SanitizedCalleRunCallObservation;
      readonly runIdHeldOnlyInBackendMemory: CalleRunId;
      readonly initialState: 'QUEUED' | 'IN_PROGRESS' | 'STATUS_UNKNOWN';
    }
  | {
      readonly kind: 'SCHEMA_DRIFT';
      readonly observation: SanitizedCalleRunCallObservation;
      readonly reason: string;
    }
  | {
      readonly kind: 'INDETERMINATE';
      readonly observation: SanitizedCalleRunCallObservation;
      readonly reason: string;
    };

export interface SanitizedCalleStatusObservation {
  readonly structuredPayloadPath: CalleLiveStructuredPayloadPath | null;
  readonly runId: SanitizedOpaqueFieldObservation;
  readonly status: CalleSanitizedFieldType & { readonly sanitizedValue: string | null };
  readonly activity: CalleSanitizedFieldType & { readonly sanitizedMessages: readonly string[] };
  readonly summary: SanitizedTextFieldObservation;
  readonly transcript: CalleSanitizedFieldType & { readonly sanitizedLines: readonly string[] };
  readonly nextStep: SanitizedTextFieldObservation;
  readonly unexpectedFields: readonly string[];
  readonly securitySignals: readonly string[];
}

export type CalleGetCallRunContractResult =
  | {
      readonly kind: 'STATUS_OBSERVED';
      readonly observation: SanitizedCalleStatusObservation;
      readonly normalized: CalleRunStatusObservation;
    }
  | {
      readonly kind: 'SCHEMA_DRIFT';
      readonly observation: SanitizedCalleStatusObservation;
      readonly reason: string;
    }
  | {
      readonly kind: 'INDETERMINATE';
      readonly observation: SanitizedCalleStatusObservation;
      readonly reason: string;
    };

interface LocatedPayload {
  readonly payload: Record<string, unknown> | null;
  readonly path: CalleLiveStructuredPayloadPath | null;
  readonly reason: string | null;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasOwn(record: Record<string, unknown> | null, key: string): boolean {
  return record !== null && Object.hasOwn(record, key);
}

function jsonValueType(value: unknown): JsonValueType {
  if (value === undefined) return 'absent';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'object';
}

function fieldType(payload: Record<string, unknown> | null, key: string): JsonValueType {
  return hasOwn(payload, key) ? jsonValueType(payload?.[key]) : 'absent';
}

function opaqueField(payload: Record<string, unknown> | null, key: string): SanitizedOpaqueFieldObservation {
  const present = hasOwn(payload, key);
  const value = payload?.[key];
  return Object.freeze({
    present,
    type: fieldType(payload, key),
    nonEmptyString: typeof value === 'string' && value.trim().length > 0,
  });
}

function safeUnexpectedField(name: string): string {
  return SAFE_FIELD_NAME.test(name) && !SENSITIVE_FIELD_NAME.test(name)
    ? name
    : '[redacted-field-name]';
}

function unexpectedFields(payload: Record<string, unknown> | null, allowed: ReadonlySet<string>): readonly string[] {
  if (payload === null) return Object.freeze([]);
  return Object.freeze(
    [...new Set(Object.keys(payload).filter((key) => !allowed.has(key)).map(safeUnexpectedField))].sort(),
  );
}

function hasIndicator(payload: Record<string, unknown>, fields: ReadonlySet<string>): boolean {
  return [...fields].some((field) => Object.hasOwn(payload, field));
}

function locateOuterPayload(response: unknown, fields: ReadonlySet<string>): LocatedPayload {
  const root = recordOf(response);
  if (root === null) return { payload: null, path: null, reason: 'STRUCTURED_PAYLOAD_MISSING' };
  const candidates: Array<Readonly<{ payload: Record<string, unknown>; path: CalleLiveStructuredPayloadPath }>> = [];
  let invalidEnvelope = false;
  for (const [key, path] of [
    ['structuredContent', 'result.structuredContent'],
    ['structured_content', 'result.structured_content'],
  ] as const) {
    if (!Object.hasOwn(root, key)) continue;
    const payload = recordOf(root[key]);
    if (payload === null) invalidEnvelope = true;
    else candidates.push({ payload, path });
  }
  if (hasIndicator(root, fields)) candidates.push({ payload: root, path: 'result' });
  if (invalidEnvelope) return { payload: null, path: null, reason: 'STRUCTURED_PAYLOAD_INVALID' };
  if (candidates.length === 0) return { payload: null, path: null, reason: 'STRUCTURED_PAYLOAD_MISSING' };
  if (candidates.length !== 1) return { payload: null, path: null, reason: 'STRUCTURED_PAYLOAD_AMBIGUOUS' };
  const candidate = candidates[0];
  return candidate === undefined
    ? { payload: null, path: null, reason: 'STRUCTURED_PAYLOAD_MISSING' }
    : { ...candidate, reason: null };
}

function locateStatusPayload(response: unknown): LocatedPayload {
  const outer = locateOuterPayload(response, STATUS_OUTPUT_FIELDS);
  if (outer.payload === null || outer.path === null) return outer;
  const nested = recordOf(outer.payload.result);
  if (hasOwn(outer.payload, 'result') && nested === null) {
    return { payload: null, path: null, reason: 'STATUS_RESULT_INVALID' };
  }
  const outerHasExecution = hasIndicator(outer.payload, EXECUTION_FIELDS);
  const nestedHasExecution = nested !== null && hasIndicator(nested, EXECUTION_FIELDS);
  const outerHasEvidence = hasIndicator(outer.payload, BUSINESS_EVIDENCE_FIELDS);
  const nestedHasEvidence = nested !== null && hasIndicator(nested, BUSINESS_EVIDENCE_FIELDS);
  if ((outerHasExecution && nestedHasExecution)
    || (outerHasEvidence && (nestedHasEvidence || nestedHasExecution))) {
    return { payload: null, path: null, reason: 'STATUS_PAYLOAD_AMBIGUOUS' };
  }
  if (!outerHasExecution && nestedHasExecution && nested !== null) {
    return {
      payload: nested,
      path: `${outer.path}.result` as CalleLiveStructuredPayloadPath,
      reason: null,
    };
  }
  return outer;
}

function emptyRunObservation(): SanitizedCalleRunCallObservation {
  return Object.freeze({
    structuredPayloadPath: null,
    runId: Object.freeze({ present: false, type: 'absent', nonEmptyString: false }),
    status: Object.freeze({ present: false, type: 'absent' }),
    unexpectedFields: Object.freeze([]),
  });
}

export function classifyCalleRunCallResponse(response: unknown): CalleRunCallContractResult {
  const located = locateOuterPayload(response, RUN_OUTPUT_FIELDS);
  if (located.payload === null || located.path === null) {
    return {
      kind: 'INDETERMINATE',
      observation: emptyRunObservation(),
      reason: located.reason ?? 'STRUCTURED_PAYLOAD_MISSING',
    };
  }
  const payload = located.payload;
  const observation: SanitizedCalleRunCallObservation = Object.freeze({
    structuredPayloadPath: located.path,
    runId: opaqueField(payload, 'run_id'),
    status: Object.freeze({ present: hasOwn(payload, 'status'), type: fieldType(payload, 'status') }),
    unexpectedFields: unexpectedFields(payload, RUN_OUTPUT_FIELDS),
  });
  if (!observation.runId.present) {
    return { kind: 'INDETERMINATE', observation, reason: 'RUN_ID_ABSENT_AFTER_DISPATCH' };
  }
  if (!observation.runId.nonEmptyString) {
    return { kind: 'SCHEMA_DRIFT', observation, reason: 'RUN_ID_NOT_NON_EMPTY_STRING' };
  }
  if (!observation.status.present) {
    return {
      kind: 'RUN_ACCEPTED',
      observation,
      runIdHeldOnlyInBackendMemory: asCalleRunId(payload.run_id),
      initialState: 'STATUS_UNKNOWN',
    };
  }
  if (observation.status.type !== 'string') {
    return { kind: 'SCHEMA_DRIFT', observation, reason: 'INITIAL_STATUS_NOT_STRING' };
  }
  const state = payload.status;
  if (state !== 'QUEUED' && state !== 'IN_PROGRESS') {
    return { kind: 'SCHEMA_DRIFT', observation, reason: 'INITIAL_STATUS_UNCONFIRMED' };
  }
  return {
    kind: 'RUN_ACCEPTED',
    observation,
    runIdHeldOnlyInBackendMemory: asCalleRunId(payload.run_id),
    initialState: state,
  };
}

function safeText(value: unknown, signals: Set<string>, signal: string): string | null {
  if (typeof value !== 'string') {
    if (value !== null && value !== undefined) signals.add(`${signal}_NOT_TEXT`);
    return null;
  }
  const sanitized = sanitizeCallePlanText(value);
  if (sanitized === null) signals.add(`${signal}_REDACTED`);
  return sanitized;
}

function sanitizedTextField(
  payload: Record<string, unknown>,
  key: string,
  signals: Set<string>,
): SanitizedTextFieldObservation {
  const present = hasOwn(payload, key);
  const type = fieldType(payload, key);
  if (!present) return Object.freeze({ present: false, type: 'absent' });
  const sanitizedText = safeText(payload[key], signals, key.toUpperCase());
  return sanitizedText === null
    ? Object.freeze({ present, type })
    : Object.freeze({ present, type, sanitizedText });
}

function sanitizedLines(
  value: unknown,
  signals: Set<string>,
  signal: string,
): readonly string[] {
  const source = typeof value === 'string' ? value.split(/\r\n|\n|\r/u) : Array.isArray(value) ? value : [];
  if (!Array.isArray(value) && typeof value !== 'string' && value !== undefined && value !== null) {
    signals.add(`${signal}_INVALID_TYPE`);
  }
  return Object.freeze(
    source
      .map((item) => safeText(item, signals, signal))
      .filter((item): item is string => item !== null),
  );
}

function activityMessages(value: unknown, signals: Set<string>): readonly string[] {
  if (value === undefined || value === null) return Object.freeze([]);
  if (!Array.isArray(value)) {
    signals.add('ACTIVITY_INVALID_TYPE');
    return Object.freeze([]);
  }
  const messages: string[] = [];
  for (const item of value) {
    const record = recordOf(item);
    if (record === null) {
      signals.add('ACTIVITY_ITEM_INVALID');
      continue;
    }
    const message = safeText(record.message, signals, 'ACTIVITY_TEXT');
    if (message !== null) messages.push(message);
  }
  return Object.freeze(messages);
}

function normalizedStatus(value: unknown): CalleRunStatusObservation['state'] | null {
  if (value === 'QUEUED' || value === 'IN_PROGRESS' || value === 'COMPLETED' || value === 'FAILED') {
    return value;
  }
  if (typeof value === 'string' && TERMINAL_FAILURE_STATES.has(value)) return 'FAILED';
  return null;
}

function emptyStatusObservation(): SanitizedCalleStatusObservation {
  return Object.freeze({
    structuredPayloadPath: null,
    runId: Object.freeze({ present: false, type: 'absent', nonEmptyString: false }),
    status: Object.freeze({ present: false, type: 'absent', sanitizedValue: null }),
    activity: Object.freeze({ present: false, type: 'absent', sanitizedMessages: Object.freeze([]) }),
    summary: Object.freeze({ present: false, type: 'absent' }),
    transcript: Object.freeze({ present: false, type: 'absent', sanitizedLines: Object.freeze([]) }),
    nextStep: Object.freeze({ present: false, type: 'absent' }),
    unexpectedFields: Object.freeze([]),
    securitySignals: Object.freeze([]),
  });
}

function sanitizedNextStep(payload: Record<string, unknown>, signals: Set<string>): SanitizedTextFieldObservation {
  const nextStep = recordOf(payload.next_step);
  if (nextStep === null) return sanitizedTextField(payload, 'next_step', signals);
  // The observed instruction is display data. No action or tool metadata is interpreted.
  const sanitizedText = safeText(nextStep.instruction, signals, 'NEXT_STEP_INSTRUCTION');
  return Object.freeze({ present: true, type: 'object', ...(sanitizedText === null ? {} : { sanitizedText }) });
}

export function classifyCalleGetCallRunResponse(response: unknown): CalleGetCallRunContractResult {
  const located = locateStatusPayload(response);
  if (located.payload === null || located.path === null) {
    return {
      kind: 'INDETERMINATE',
      observation: emptyStatusObservation(),
      reason: located.reason ?? 'STATUS_PAYLOAD_MISSING',
    };
  }
  const payload = located.payload;
  const nested = recordOf(payload.result);
  if (hasOwn(payload, 'result') && nested === null) {
    return { kind: 'INDETERMINATE', observation: emptyStatusObservation(), reason: 'STATUS_RESULT_INVALID' };
  }
  if (nested !== null && (hasIndicator(nested, EXECUTION_FIELDS)
    || (hasIndicator(payload, BUSINESS_EVIDENCE_FIELDS) && hasIndicator(nested, BUSINESS_EVIDENCE_FIELDS)))) {
    return { kind: 'INDETERMINATE', observation: emptyStatusObservation(), reason: 'STATUS_PAYLOAD_AMBIGUOUS' };
  }
  const evidence = nested ?? payload;
  const signals = new Set<string>();
  const summaryKey = evidence.post_summary != null ? 'post_summary'
    : hasOwn(evidence, 'summary') ? 'summary' : nested === null ? 'message' : 'post_summary';
  const summary = sanitizedTextField(evidence, summaryKey, signals);
  const nextStep = sanitizedNextStep(payload, signals);
  const transcript = sanitizedLines(evidence.transcript, signals, 'TRANSCRIPT_TEXT');
  const activity = activityMessages(payload.activity, signals);
  const statusText = safeText(payload.status, signals, 'STATUS_TEXT');
  const state = normalizedStatus(payload.status);
  const failureReason = state === 'FAILED'
    ? safeText(payload.error ?? payload.message, signals, 'FAILURE_TEXT')
    : null;
  const observation: SanitizedCalleStatusObservation = Object.freeze({
    structuredPayloadPath: located.path,
    runId: opaqueField(payload, 'run_id'),
    status: Object.freeze({
      present: hasOwn(payload, 'status'),
      type: fieldType(payload, 'status'),
      sanitizedValue: statusText,
    }),
    activity: Object.freeze({
      present: hasOwn(payload, 'activity'),
      type: fieldType(payload, 'activity'),
      sanitizedMessages: activity,
    }),
    summary,
    transcript: Object.freeze({
      present: hasOwn(evidence, 'transcript'),
      type: fieldType(evidence, 'transcript'),
      sanitizedLines: transcript,
    }),
    nextStep,
    unexpectedFields: unexpectedFields(payload, STATUS_OUTPUT_FIELDS),
    securitySignals: Object.freeze([...signals].sort()),
  });
  if (!observation.status.present) {
    return { kind: 'INDETERMINATE', observation, reason: 'STATUS_ABSENT' };
  }
  if (observation.status.type !== 'string') {
    return { kind: 'SCHEMA_DRIFT', observation, reason: 'STATUS_NOT_STRING' };
  }
  if (state === null) {
    return { kind: 'SCHEMA_DRIFT', observation, reason: 'STATUS_VALUE_UNCONFIRMED' };
  }
  return {
    kind: 'STATUS_OBSERVED',
    observation,
    normalized: Object.freeze({
      state,
      transcript,
      summary: summary.sanitizedText ?? null,
      failureReason,
    }),
  };
}

export function safeRemoteReasonCode(value: unknown): string {
  return typeof value === 'string' && SAFE_REASON_CODE.test(value)
    ? value
    : 'REMOTE_REASON_REDACTED';
}
