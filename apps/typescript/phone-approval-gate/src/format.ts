/**
 * Human-readable output. Phone numbers are masked everywhere except the request
 * file itself and a preview never prints a code that a live call will use.
 */

import { maskPhone } from "./decide.js";
import { codeDecimalDigits, phraseEntropyBits } from "./secret.js";
import { buildResultSchema, buildTask, type CallSecret } from "./script.js";
import type { ApprovalRequest, AttemptEvaluation, GateResult } from "./types.js";

export function renderPreview(request: ApprovalRequest, sampleSecret: CallSecret): string {
  const lines: string[] = [];
  lines.push(`Preview only. No call is placed and no credentials are used.`);
  lines.push("");
  lines.push(`Request       ${request.requestId}`);
  lines.push(`Change        ${request.change.title}`);
  lines.push(`Environment   ${request.change.environment}`);
  lines.push(`Requested by  ${request.change.requested_by}`);
  lines.push(
    `Policy        ${request.policy.mode} control, ${request.policy.binding}, ${request.policy.windowSeconds}s window, ${request.policy.perCallTimeoutSeconds}s per call`,
  );
  lines.push(
    `Secret        ${
      request.policy.binding === "code_from_request"
        ? `${codeDecimalDigits()} digit code shown on this request, never spoken by the caller`
        : `${phraseEntropyBits()} bits of phrase read out on the call and repeated back`
    }`,
  );
  lines.push("");
  lines.push("Ladder");
  for (const [index, approver] of request.approvers.entries()) {
    lines.push(
      `  ${index + 1}. ${approver.name} (${approver.id}) ${maskPhone(approver.phone)} enrolled ${approver.enrolled_at}`,
    );
  }
  lines.push("");
  lines.push(`Call script for ${request.approvers[0]?.id ?? "the first approver"}`);
  lines.push("");
  const script = buildTask(request, request.approvers[0]!, sampleSecret);
  for (const line of script.split("\n")) {
    lines.push(line.length === 0 ? "" : `  ${line}`);
  }
  lines.push("");
  lines.push("Result contract");
  lines.push(`  ${JSON.stringify(buildResultSchema())}`);
  lines.push("");
  lines.push("Nothing above has been sent anywhere. Add --live to place the call.");
  return lines.join("\n");
}

export function renderAttempt(attempt: AttemptEvaluation): string {
  const parts = [
    `${attempt.approver_id} ${attempt.phone_masked}`,
    attempt.outcome,
    attempt.reason === null ? "" : `(${attempt.reason})`,
    attempt.call_id === null ? "" : attempt.call_id,
  ].filter((part) => part.length > 0);
  return `  ${parts.join("  ")}`;
}

export function renderResult(result: GateResult): string {
  const lines: string[] = [];
  lines.push(`Verdict  ${result.verdict}${result.reason === null ? "" : ` (${result.reason})`}`);
  if (result.approved_by.length > 0) {
    lines.push(`Approved by  ${result.approved_by.join(", ")}`);
  }
  lines.push("Attempts");
  for (const attempt of result.attempts) {
    lines.push(renderAttempt(attempt));
  }
  if (result.audit_record_hash !== null) {
    lines.push(`Audit record  ${result.audit_record_hash}`);
  }
  return lines.join("\n");
}
