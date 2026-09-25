import type { CallWorkflowStatus } from "./types";

/** Durable job states aligned with workflow statuses. */
export type CallJobState =
  | "draft"
  | "ready"
  | "blocked"
  | "submitting"
  | "active"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown";

const WORKFLOW_TO_JOB: Record<CallWorkflowStatus, CallJobState> = {
  prepared: "ready",
  starting: "submitting",
  in_progress: "active",
  completed: "completed",
  dry_run_completed: "completed",
  no_answer: "completed",
  failed: "failed",
  cancelled: "cancelled",
  unknown: "unknown",
};

const LEGAL_TRANSITIONS: Record<CallJobState, readonly CallJobState[]> = {
  draft: ["ready", "blocked"],
  ready: ["submitting", "blocked", "cancelled"],
  blocked: ["ready", "cancelled"],
  submitting: ["active", "completed", "failed", "cancelled", "unknown"],
  active: ["completed", "failed", "cancelled", "unknown"],
  completed: [],
  failed: ["ready"],
  cancelled: [],
  unknown: ["ready", "failed", "cancelled"],
};

export function workflowStatusToJobState(status: CallWorkflowStatus): CallJobState {
  return WORKFLOW_TO_JOB[status] ?? "unknown";
}

export function canTransitionJob(from: CallJobState, to: CallJobState): boolean {
  if (from === to) return true;
  return LEGAL_TRANSITIONS[from].includes(to);
}

export function assertJobTransition(from: CallWorkflowStatus, to: CallWorkflowStatus): void {
  const fromJob = workflowStatusToJobState(from);
  const toJob = workflowStatusToJobState(to);
  if (!canTransitionJob(fromJob, toJob)) {
    throw new Error(`Illegal call job transition: ${from} (${fromJob}) -> ${to} (${toJob})`);
  }
}

export function isTerminalJobState(state: CallJobState): boolean {
  return state === "completed" || state === "cancelled" || state === "failed";
}

export function isTerminalWorkflowStatus(status: CallWorkflowStatus): boolean {
  return isTerminalJobState(workflowStatusToJobState(status));
}
