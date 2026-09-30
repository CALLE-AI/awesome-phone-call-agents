import type { CallWorkflowStatus } from "./types";
import type { PhoneTaskStatus } from "./phone-task";

const LEGAL: Record<PhoneTaskStatus, readonly PhoneTaskStatus[]> = {
  draft: ["approved", "blocked", "canceled"],
  approved: ["queued", "blocked", "canceled"],
  queued: ["dialing", "canceled", "blocked"],
  dialing: ["ringing", "failed", "canceled", "no_answer", "busy"],
  ringing: ["connected", "no_answer", "busy", "voicemail", "failed", "canceled"],
  connected: ["in_progress", "failed", "canceled"],
  in_progress: ["completed", "failed", "canceled", "needs_review", "voicemail"],
  completed: ["needs_review"],
  no_answer: ["queued", "needs_review"],
  busy: ["queued", "needs_review"],
  voicemail: ["queued", "needs_review", "completed"],
  failed: ["queued", "needs_review"],
  canceled: [],
  blocked: ["draft", "canceled"],
  needs_review: ["completed", "queued", "canceled"],
};

export function canTransitionPhoneStatus(from: PhoneTaskStatus, to: PhoneTaskStatus): boolean {
  if (from === to) return true;
  return LEGAL[from].includes(to);
}

export function assertPhoneStatusTransition(from: PhoneTaskStatus, to: PhoneTaskStatus): void {
  if (!canTransitionPhoneStatus(from, to)) {
    throw new Error(`Illegal phone task transition: ${from} -> ${to}`);
  }
}

/** Map V1/V2 workflow statuses into the richer phone-task state space. */
export function workflowStatusToPhoneStatus(status: CallWorkflowStatus): PhoneTaskStatus {
  switch (status) {
    case "prepared":
      return "approved";
    case "starting":
      return "dialing";
    case "in_progress":
      return "in_progress";
    case "completed":
    case "dry_run_completed":
      return "completed";
    case "no_answer":
      return "no_answer";
    case "failed":
      return "failed";
    case "cancelled":
      return "canceled";
    case "unknown":
    default:
      return "needs_review";
  }
}

export function phoneStatusToWorkflowStatus(status: PhoneTaskStatus): CallWorkflowStatus {
  switch (status) {
    case "draft":
    case "approved":
    case "queued":
      return "prepared";
    case "dialing":
    case "ringing":
    case "connected":
      return "starting";
    case "in_progress":
      return "in_progress";
    case "completed":
      return "completed";
    case "no_answer":
    case "busy":
    case "voicemail":
      return "no_answer";
    case "failed":
      return "failed";
    case "canceled":
      return "cancelled";
    case "blocked":
      return "failed";
    case "needs_review":
      return "unknown";
  }
}

export function isTerminalPhoneStatus(status: PhoneTaskStatus): boolean {
  return status === "completed" || status === "canceled" || status === "blocked";
}
