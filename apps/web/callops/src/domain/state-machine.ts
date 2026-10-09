import { InvalidTransitionError } from './errors';
import type { CallRun, CallRunState } from './models';

const ALLOWED_TRANSITIONS: Readonly<Record<CallRunState, ReadonlySet<CallRunState>>> = {
  DRAFT: new Set(['WAITING_FOR_APPROVAL', 'CANCELLED']),
  WAITING_FOR_APPROVAL: new Set(['APPROVED', 'REJECTED', 'CANCELLED']),
  APPROVED: new Set(['WAITING_FOR_APPROVAL', 'QUEUED', 'CANCELLED']),
  REJECTED: new Set(['WAITING_FOR_APPROVAL', 'CANCELLED']),
  QUEUED: new Set(['IN_PROGRESS', 'FAILED', 'CANCELLED']),
  IN_PROGRESS: new Set(['COMPLETED', 'FAILED', 'CANCELLED']),
  COMPLETED: new Set(),
  FAILED: new Set(),
  CANCELLED: new Set(),
};

export function assertTransition(from: CallRunState, to: CallRunState): void {
  if (!ALLOWED_TRANSITIONS[from].has(to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function transitionRun(
  run: CallRun,
  nextState: CallRunState,
  updatedAt: string,
): CallRun {
  assertTransition(run.state, nextState);
  return {
    ...run,
    state: nextState,
    updatedAt,
  };
}

export function isTerminalState(state: CallRunState): boolean {
  return state === 'COMPLETED' || state === 'FAILED' || state === 'CANCELLED';
}
