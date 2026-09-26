import { asCalleRunId } from './calle-live-capability-vault';
import { CalleLiveAdapterError } from './calle-live-errors';
import {
  CALLE_RUN_CHECKPOINT_PHASES,
  type CalleRunCheckpointPhase,
  type CalleRunCheckpointRecord,
  type CalleRunId,
} from './calle-live-types';

export const CALLE_RUN_CHECKPOINT_SCHEMA_VERSION = 1 as const;

const CHECKPOINT_KEYS = Object.freeze([
  'schemaVersion',
  'revision',
  'phase',
  'runId',
  'remoteState',
  'terminalState',
  'updatedAt',
  'reasonCode',
] as const);

const SAFE_REASON_CODE = /^[A-Z][A-Z0-9_]{0,63}$/u;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function fail(message: string, code: string): never {
  throw new CalleLiveAdapterError(message, code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalRunId(value: unknown): CalleRunId | null {
  if (value === null) return null;
  return asCalleRunId(value);
}

function checkpointPhase(value: unknown): CalleRunCheckpointPhase {
  if (
    typeof value !== 'string' ||
    !CALLE_RUN_CHECKPOINT_PHASES.includes(value as CalleRunCheckpointPhase)
  ) {
    fail('The durable checkpoint phase is invalid.', 'RUN_CHECKPOINT_PHASE_INVALID');
  }
  return value as CalleRunCheckpointPhase;
}

function assertShapeInvariants(record: CalleRunCheckpointRecord): void {
  const hasRunId = record.runId !== null;
  if (
    ['RUN_REQUESTED', 'REMOTE_EXECUTION_UNCERTAIN'].includes(record.phase) &&
    (hasRunId || record.remoteState !== null || record.terminalState !== null)
  ) {
    fail('The pre-identifier checkpoint contains forbidden run data.', 'RUN_CHECKPOINT_INVARIANT');
  }
  if (
    record.phase === 'RUN_ID_RECEIVED' &&
    (!hasRunId || !['QUEUED', 'IN_PROGRESS'].includes(record.remoteState ?? '') || record.terminalState !== null)
  ) {
    fail('The received-run checkpoint is incomplete.', 'RUN_CHECKPOINT_INVARIANT');
  }
  if (
    ['STATUS_UNKNOWN', 'LOCAL_TRACKING_STOPPED'].includes(record.phase) &&
    (!hasRunId || record.remoteState !== null || record.terminalState !== null)
  ) {
    fail('The recoverable checkpoint is inconsistent.', 'RUN_CHECKPOINT_INVARIANT');
  }
  if (record.phase === 'TERMINAL') {
    if (record.remoteState !== null || !['COMPLETED', 'FAILED'].includes(record.terminalState ?? '')) {
      fail('The terminal checkpoint is incomplete.', 'RUN_CHECKPOINT_INVARIANT');
    }
    if (record.terminalState === 'COMPLETED' && !hasRunId) {
      fail('A completed checkpoint requires a run identifier.', 'RUN_CHECKPOINT_INVARIANT');
    }
  }
}

export function parseCalleRunCheckpoint(value: unknown): CalleRunCheckpointRecord {
  if (!isRecord(value)) {
    fail('The durable checkpoint is not a JSON object.', 'RUN_CHECKPOINT_NOT_OBJECT');
  }
  const unexpected = Object.keys(value).filter(
    (key) => !(CHECKPOINT_KEYS as readonly string[]).includes(key),
  );
  if (unexpected.length > 0 || Object.keys(value).length !== CHECKPOINT_KEYS.length) {
    fail('The durable checkpoint fields do not match the local schema.', 'RUN_CHECKPOINT_SCHEMA_DRIFT');
  }
  if (value.schemaVersion !== CALLE_RUN_CHECKPOINT_SCHEMA_VERSION) {
    fail('The durable checkpoint schema version is unsupported.', 'RUN_CHECKPOINT_VERSION_UNSUPPORTED');
  }
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 1) {
    fail('The durable checkpoint revision is invalid.', 'RUN_CHECKPOINT_REVISION_INVALID');
  }
  if (typeof value.updatedAt !== 'string' || !ISO_INSTANT.test(value.updatedAt)) {
    fail('The durable checkpoint timestamp is invalid.', 'RUN_CHECKPOINT_TIMESTAMP_INVALID');
  }
  if (
    value.reasonCode !== null &&
    (typeof value.reasonCode !== 'string' || !SAFE_REASON_CODE.test(value.reasonCode))
  ) {
    fail('The durable checkpoint reason code is invalid.', 'RUN_CHECKPOINT_REASON_INVALID');
  }
  if (
    value.remoteState !== null &&
    value.remoteState !== 'QUEUED' &&
    value.remoteState !== 'IN_PROGRESS'
  ) {
    fail('The durable checkpoint remote state is invalid.', 'RUN_CHECKPOINT_REMOTE_STATE_INVALID');
  }
  if (
    value.terminalState !== null &&
    value.terminalState !== 'COMPLETED' &&
    value.terminalState !== 'FAILED'
  ) {
    fail('The durable checkpoint terminal state is invalid.', 'RUN_CHECKPOINT_TERMINAL_STATE_INVALID');
  }

  const parsed: CalleRunCheckpointRecord = Object.freeze({
    schemaVersion: CALLE_RUN_CHECKPOINT_SCHEMA_VERSION,
    revision: value.revision as number,
    phase: checkpointPhase(value.phase),
    runId: optionalRunId(value.runId),
    remoteState: value.remoteState,
    terminalState: value.terminalState,
    updatedAt: value.updatedAt,
    reasonCode: value.reasonCode,
  });
  assertShapeInvariants(parsed);
  return parsed;
}

export function cloneCalleRunCheckpoint(
  checkpoint: CalleRunCheckpointRecord,
): CalleRunCheckpointRecord {
  return parseCalleRunCheckpoint(structuredClone(checkpoint));
}
