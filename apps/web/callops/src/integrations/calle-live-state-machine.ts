import { CalleLiveAdapterError } from './calle-live-errors';
import type { CalleLiveState } from './calle-live-types';

const ALLOWED_LIVE_TRANSITIONS: Readonly<Record<CalleLiveState, ReadonlySet<CalleLiveState>>> = {
  DRAFT: new Set([
    'NEEDS_DETAILS',
    'READY_FOR_REVIEW',
    'REMOTE_EXECUTION_UNCERTAIN',
    'COMPLETED',
    'FAILED',
    'CANCELLED_LOCAL',
    'STATUS_UNKNOWN',
  ]),
  NEEDS_DETAILS: new Set(['DRAFT']),
  READY_FOR_REVIEW: new Set(['DRAFT', 'WAITING_FOR_APPROVAL']),
  WAITING_FOR_APPROVAL: new Set(['DRAFT', 'APPROVED', 'CANCELLED_LOCAL']),
  APPROVED: new Set(['DRAFT', 'RUN_REQUESTED', 'CANCELLED_LOCAL']),
  RUN_REQUESTED: new Set([
    'REMOTE_EXECUTION_UNCERTAIN',
    'QUEUED',
    'IN_PROGRESS',
    'STATUS_UNKNOWN',
    'FAILED',
  ]),
  REMOTE_EXECUTION_UNCERTAIN: new Set(),
  QUEUED: new Set(['IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED_LOCAL', 'STATUS_UNKNOWN']),
  IN_PROGRESS: new Set(['COMPLETED', 'FAILED', 'CANCELLED_LOCAL', 'STATUS_UNKNOWN']),
  COMPLETED: new Set(),
  FAILED: new Set(),
  CANCELLED_LOCAL: new Set(),
  STATUS_UNKNOWN: new Set(['QUEUED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED_LOCAL']),
};

export function assertCalleLiveTransition(from: CalleLiveState, to: CalleLiveState): void {
  if (!ALLOWED_LIVE_TRANSITIONS[from].has(to)) {
    throw new CalleLiveAdapterError(
      `Live transition refused: ${from} -> ${to}.`,
      'INVALID_LIVE_TRANSITION',
    );
  }
}

export function isCalleLiveTerminal(state: CalleLiveState): boolean {
  return [
    'COMPLETED',
    'FAILED',
    'CANCELLED_LOCAL',
    'REMOTE_EXECUTION_UNCERTAIN',
  ].includes(state);
}
