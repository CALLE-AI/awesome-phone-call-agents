/**
 * The gate: one call per approver, in order, inside one window.
 *
 * The ladder exists because the first person does not always pick up. It stops
 * the moment someone decides and a rejection is final. Each approver gets a
 * distinct secret, so an approval recorded against one handset cannot be
 * produced from another.
 */

import {
  appendRecord,
  buildRecord,
  nextSequence,
  previousHash,
  readRecords,
} from "./audit.js";
import { GateApiError, GateTimeoutError, type CallePort } from "./calle.js";
import { evaluateAttempt, verdictFromAttempts } from "./decide.js";
import {
  buildMetadata,
  buildResultSchema,
  buildTask,
  codeForRequestChannel,
  idempotencyKey,
  type CallSecret,
} from "./script.js";
import { generateCode, generatePhrase } from "./secret.js";
import type {
  ApprovalRequest,
  Approver,
  AttemptEvaluation,
  CallSnapshot,
  GateResult,
  NotApprovedReason,
} from "./types.js";

export interface RunGateOptions {
  request: ApprovalRequest;
  port: CallePort;
  auditPath?: string | null;
  pollIntervalMs?: number;
  now?: () => number;
  makeSecret?: (approver: Approver) => CallSecret;
  onProgress?: (line: string) => void;
  /** Called with the code a person must read back, before the phone rings. */
  onSecret?: (approver: Approver, display: string) => void;
}

function defaultSecret(): CallSecret {
  return { code: generateCode(), phrase: generatePhrase() };
}

export async function runGate(options: RunGateOptions): Promise<GateResult> {
  const { request, port } = options;
  const now = options.now ?? (() => Date.now());
  const progress = options.onProgress ?? (() => {});
  const makeSecret = options.makeSecret ?? (() => defaultSecret());
  const pollIntervalMs = options.pollIntervalMs ?? 2000;

  const deadline = now() + request.policy.windowSeconds * 1000;
  const needed = request.policy.mode === "dual" ? 2 : 1;
  const attempts: AttemptEvaluation[] = [];
  let failures = 0;
  let stopReason: NotApprovedReason | null = null;
  let approvals = 0;

  for (const [index, approver] of request.approvers.entries()) {
    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      stopReason = "window_expired";
      progress(`Approval window closed before calling ${approver.id}.`);
      break;
    }
    if (failures >= request.policy.maxFailedAttempts) {
      stopReason = "attempt_limit";
      progress(`Stopped after ${failures} failed attempts.`);
      break;
    }

    const secret = makeSecret(approver);
    const timeoutMs = Math.min(request.policy.perCallTimeoutSeconds * 1000, remainingMs);
    if (request.policy.binding === "code_from_request") {
      options.onSecret?.(approver, codeForRequestChannel(secret));
    }
    progress(`Calling ${approver.name} (${approver.id}), attempt ${index + 1}.`);

    const recipient = {
      phones: [approver.phone],
      ...(approver.region === undefined ? {} : { region: approver.region }),
      ...(approver.locale === undefined ? {} : { locale: approver.locale }),
    };

    let call: CallSnapshot | null = null;
    let apiErrorCode: string | null = null;
    try {
      const created = await port.createCall(
        {
          task: buildTask(request, approver, secret),
          recipients: [recipient],
          resultSchema: buildResultSchema(),
          metadata: buildMetadata(request, approver, index + 1),
        },
        idempotencyKey(request, approver, index + 1),
      );
      progress(`Call ${created.id} created for ${approver.id}.`);
      try {
        call = await port.waitForResult(created.id, { timeoutMs, intervalMs: pollIntervalMs });
      } catch (error) {
        if (error instanceof GateTimeoutError) {
          progress(`Call ${created.id} did not finish within ${Math.round(timeoutMs / 1000)}s.`);
          call = await port.getCall(created.id);
        } else {
          throw error;
        }
      }
    } catch (error) {
      apiErrorCode = error instanceof GateApiError ? error.code : "sdk_error";
      progress(`CALL-E returned ${apiErrorCode} for ${approver.id}.`);
    }

    const evaluation = evaluateAttempt({
      request,
      approver,
      call,
      code: secret.code,
      phrase: secret.phrase,
      apiErrorCode,
    });
    attempts.push(evaluation);
    progress(
      `Attempt for ${approver.id}: ${evaluation.outcome}${
        evaluation.reason === null ? "" : ` (${evaluation.reason})`
      }.`,
    );

    if (evaluation.outcome === "rejected") {
      break;
    }
    if (evaluation.outcome === "approved") {
      approvals += 1;
      if (approvals >= needed) {
        break;
      }
      continue;
    }
    failures += 1;
  }

  const folded = verdictFromAttempts(attempts, request.policy);
  const verdict = folded.verdict;
  let reason = folded.reason;
  if (verdict === "not_approved" && stopReason !== null) {
    reason = stopReason;
  }
  if (verdict === "not_approved" && attempts.length === 0 && reason === null) {
    reason = stopReason ?? "not_reached";
  }

  let auditRecordHash: string | null = null;
  if (options.auditPath !== null && options.auditPath !== undefined) {
    const existing = readRecords(options.auditPath);
    const record = buildRecord({
      request,
      attempts,
      verdict,
      reason,
      approvedBy: folded.approvedBy,
      previousHash: previousHash(existing),
      sequence: nextSequence(existing),
      recordedAt: new Date(now()).toISOString(),
    });
    appendRecord(options.auditPath, record);
    auditRecordHash = record.hash;
  }

  return {
    verdict,
    reason,
    request_id: request.requestId,
    approved_by: folded.approvedBy,
    attempts,
    audit_record_hash: auditRecordHash,
  };
}
