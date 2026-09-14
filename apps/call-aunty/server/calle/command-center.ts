import { workflowStatusToPhoneStatus } from "./phone-state";
import type { PhoneTaskStatus } from "./phone-task";
import type { CallWorkflow, CallWorkflowStatus } from "./types";

export type CommandCenterBucket =
  | "pending"
  | "active"
  | "completed"
  | "blocked"
  | "failed"
  | "needs_review";

export type CommandCenterFilters = {
  bucket?: CommandCenterBucket;
  purpose?: CallWorkflow["purpose"];
  demoOnly?: boolean;
  since?: string;
  until?: string;
};

export type CommandCenterRow = {
  id: string;
  bucket: CommandCenterBucket;
  phoneStatus: PhoneTaskStatus;
  purpose: CallWorkflow["purpose"];
  womanId: string;
  recipientMasked: string;
  status: CallWorkflowStatus;
  policyDecision: CallWorkflow["policyDecision"];
  dryRun: boolean;
  attemptCount: number;
  canRetry: boolean;
  failureCode: CallWorkflow["failureCode"];
  updatedAt: string;
  createdAt: string;
};

function bucketFor(workflow: CallWorkflow): CommandCenterBucket {
  if (workflow.policyDecision === "deny") return "blocked";
  if (workflow.status === "failed") return "failed";
  if (workflow.status === "unknown") return "needs_review";
  if (workflow.status === "prepared") return "pending";
  if (workflow.status === "starting" || workflow.status === "in_progress") return "active";
  if (
    workflow.status === "completed" ||
    workflow.status === "dry_run_completed" ||
    workflow.status === "no_answer" ||
    workflow.status === "cancelled"
  ) {
    if (
      workflow.structuredResult &&
      (workflow.structuredResult.completionConfidence ?? 1) < 0.45
    ) {
      return "needs_review";
    }
    return "completed";
  }
  return "needs_review";
}

export function classifyWorkflowBucket(workflow: CallWorkflow): CommandCenterBucket {
  return bucketFor(workflow);
}

export function filterCommandCenterRows(
  rows: CommandCenterRow[],
  filters: CommandCenterFilters,
): CommandCenterRow[] {
  return rows.filter((row) => {
    if (filters.bucket && row.bucket !== filters.bucket) return false;
    if (filters.purpose && row.purpose !== filters.purpose) return false;
    if (filters.demoOnly !== undefined && row.dryRun !== filters.demoOnly) return false;
    if (filters.since && Date.parse(row.updatedAt) < Date.parse(filters.since)) return false;
    if (filters.until && Date.parse(row.updatedAt) > Date.parse(filters.until)) return false;
    return true;
  });
}

export function workflowToCommandRow(
  workflow: CallWorkflow,
  maskE164: (v: string) => string,
  canRetry: boolean,
): CommandCenterRow {
  return {
    id: workflow.id,
    bucket: bucketFor(workflow),
    phoneStatus: workflowStatusToPhoneStatus(workflow.status),
    purpose: workflow.purpose,
    womanId: workflow.womanId,
    recipientMasked: maskE164(workflow.recipientE164),
    status: workflow.status,
    policyDecision: workflow.policyDecision,
    dryRun: workflow.dryRun,
    attemptCount: workflow.attemptCount,
    canRetry,
    failureCode: workflow.failureCode,
    updatedAt: workflow.updatedAt,
    createdAt: workflow.createdAt,
  };
}

export function summarizeCommandCenter(rows: CommandCenterRow[]) {
  const counts: Record<CommandCenterBucket, number> = {
    pending: 0,
    active: 0,
    completed: 0,
    blocked: 0,
    failed: 0,
    needs_review: 0,
  };
  for (const row of rows) counts[row.bucket] += 1;
  return counts;
}
