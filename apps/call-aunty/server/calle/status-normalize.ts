import type { CallWorkflowStatus } from "./types";
import type { PhoneTaskStatus } from "./phone-task";
import type { ConversationState } from "./conversation-state";
import { workflowStatusToPhoneStatus } from "./phone-state";

export type NormalizedCallStatus = {
  workflow: CallWorkflowStatus;
  phone: PhoneTaskStatus;
  commandBucket: "pending" | "active" | "completed" | "blocked" | "failed" | "needs_review";
  label: string;
};

const WORKFLOW_LABELS: Record<CallWorkflowStatus, string> = {
  prepared: "Ready for confirm",
  starting: "Submitting call",
  in_progress: "In progress",
  completed: "Completed",
  no_answer: "No answer",
  failed: "Failed",
  cancelled: "Cancelled",
  dry_run_completed: "Dry-run complete",
  unknown: "Needs review",
};

export function normalizeCallStatus(workflowStatus: CallWorkflowStatus): NormalizedCallStatus {
  const phone = workflowStatusToPhoneStatus(workflowStatus);
  let commandBucket: NormalizedCallStatus["commandBucket"] = "needs_review";
  if (workflowStatus === "prepared") commandBucket = "pending";
  else if (workflowStatus === "starting" || workflowStatus === "in_progress") commandBucket = "active";
  else if (workflowStatus === "failed") commandBucket = "failed";
  else if (
    workflowStatus === "completed" ||
    workflowStatus === "dry_run_completed" ||
    workflowStatus === "no_answer" ||
    workflowStatus === "cancelled"
  ) {
    commandBucket = "completed";
  } else if (workflowStatus === "unknown") commandBucket = "needs_review";

  return {
    workflow: workflowStatus,
    phone,
    commandBucket,
    label: WORKFLOW_LABELS[workflowStatus] ?? workflowStatus,
  };
}

export function normalizeConversationLabel(state: ConversationState): string {
  return state.replace(/_/g, " ");
}

/** Compatibility: map legacy phone status strings to workflow status. */
export function phoneStatusToWorkflowCompat(phone: PhoneTaskStatus): CallWorkflowStatus {
  switch (phone) {
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
