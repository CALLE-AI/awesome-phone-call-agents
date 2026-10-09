import { containsSensitiveData } from "./redact";
import { CONFIDENCE_THRESHOLD, structuredResultValidator } from "./schemas";
import type { CaseState, Disposition } from "./types";

export { CONFIDENCE_THRESHOLD };

export interface EvaluationIntent {
  id: string;
  providerCallId: string | null;
  requestHash: string;
  taskVersion: string;
  schemaVersion: string;
  destinationFingerprint: string;
}

export interface NormalizedSnapshot {
  callId: string;
  status: string;
  taskCompleted: boolean | null;
  recipientStatus: string | null;
  confidenceScore: number | null;
  structuredResult: unknown;
  evidence: string[];
  destinationFingerprint: string;
  meta: {
    intentId: string;
    requestHash: string;
    taskVersion: string;
    schemaVersion: string;
  };
}

export interface Evaluation {
  disposition: Disposition;
  caseState: CaseState;
  failedGates: string[];
}

const TERMINAL_STATUSES = new Set([
  "completed",
  "voicemail",
  "no_answer",
  "busy",
  "failed",
  "canceled",
]);

function result(
  disposition: Disposition,
  caseState: CaseState,
  failedGates: string[],
): Evaluation {
  return { disposition, caseState, failedGates };
}

export function bindingFailures(
  intent: EvaluationIntent,
  snapshot: NormalizedSnapshot,
): string[] {
  const failed: string[] = [];
  if (intent.providerCallId === null || snapshot.callId !== intent.providerCallId) {
    failed.push("binding_call_id");
  }
  if (snapshot.meta.intentId !== intent.id) failed.push("binding_intent");
  if (snapshot.meta.requestHash !== intent.requestHash) failed.push("binding_request_hash");
  if (snapshot.meta.taskVersion !== intent.taskVersion) failed.push("binding_task_version");
  if (snapshot.meta.schemaVersion !== intent.schemaVersion) {
    failed.push("binding_schema_version");
  }
  if (snapshot.destinationFingerprint !== intent.destinationFingerprint) {
    failed.push("binding_destination");
  }
  return failed;
}

export function evaluateCallResult(
  intent: EvaluationIntent,
  snapshot: NormalizedSnapshot,
): Evaluation {
  const failed: string[] = bindingFailures(intent, snapshot);
  if (failed.length > 0) {
    return result("needs_human", "needs_human", failed);
  }

  if (!TERMINAL_STATUSES.has(snapshot.status)) {
    return result("needs_human", "needs_human", ["provider_status_terminal"]);
  }
  if (snapshot.status !== "completed") {
    return result("unreachable", "needs_human", ["provider_completed"]);
  }
  if (snapshot.taskCompleted !== true) {
    return result("needs_human", "needs_human", ["task_completed"]);
  }
  if (snapshot.recipientStatus === "refused") {
    return result("refused", "needs_human", ["recipient_completed"]);
  }
  if (snapshot.recipientStatus !== "completed") {
    return result("needs_human", "needs_human", ["recipient_completed"]);
  }

  const parsed = structuredResultValidator.safeParse(snapshot.structuredResult);
  if (!parsed.success) {
    return result("needs_human", "needs_human", ["schema_valid"]);
  }
  const r = parsed.data;

  const evidence = snapshot.evidence;
  const evidenceSensitive = evidence.some((item) => containsSensitiveData(item));
  if (r.sensitive_data_disclosed === "yes" || evidenceSensitive) {
    return result("sensitive_data", "needs_human", ["no_sensitive_data"]);
  }
  if (r.sensitive_data_disclosed === "unknown") {
    return result("needs_human", "needs_human", ["no_sensitive_data"]);
  }
  if (r.recipient_opt_out === "yes") {
    return result("refused", "needs_human", ["no_opt_out"]);
  }
  if (r.recipient_opt_out === "unknown") {
    return result("needs_human", "needs_human", ["no_opt_out"]);
  }
  if (r.change_request_status === "unable_to_verify") {
    return result("unable_to_verify", "needs_human", ["change_status_answered"]);
  }

  if (r.organization_identity !== "confirmed") failed.push("identity_confirmed");
  if (r.safe_case_code_confirmed !== "yes") failed.push("case_code_confirmed");
  if (
    snapshot.confidenceScore === null ||
    snapshot.confidenceScore < CONFIDENCE_THRESHOLD
  ) {
    failed.push("confidence_threshold");
  }
  if (evidence.length === 0) failed.push("evidence_present");
  if (
    r.change_request_status !== "initiated" &&
    r.change_request_status !== "not_initiated"
  ) {
    failed.push("change_status_answered");
  }
  if (failed.length > 0) {
    return result("needs_human", "needs_human", failed);
  }

  if (r.change_request_status === "initiated") {
    return result("confirmed", "verification_confirmed", []);
  }
  return result("denied", "verification_denied", []);
}
