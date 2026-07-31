/**
 * The gate: one call per approver, in order, inside one window.
 *
 * The ladder exists because the first person does not always pick up. It stops
 * the moment someone decides and a rejection is final. Each approver gets a
 * distinct secret, so an approval recorded against one handset cannot be
 * produced from another.
 *
 * Two rules keep a retry honest. The secret for an attempt is derived from
 * operator key material, so every runner of one request derives the same code
 * with nothing shared but the key. It is reserved on disk before the call too, so
 * a second run on the same filesystem reads back the code the approver was shown.
 * And a call the gate cannot settle stops the ladder rather than moving to the
 * next approver, because an accepted call may still be ringing the first one. A
 * create or a poll that fails without saying whether the call exists counts as
 * unsettled, so does a call that reads back as still queued, ringing or talking,
 * and so does a call somebody decided against a code this run does not hold.
 */

import {
  appendRecord,
  buildRecord,
  digestOf,
  nextSequence,
  previousHash,
  readRecords,
  withAuditLock,
} from "./audit.js";
import { GateApiError, GateTimeoutError, type CallePort, type CreateCallInput } from "./calle.js";
import { completionTime, evaluateAttempt, isTerminalCallStatus, verdictFromAttempts } from "./decide.js";
import { defaultStateDir, reserveSecret } from "./reserve.js";
import {
  buildMetadata,
  buildResultSchema,
  buildTask,
  codeForRequestChannel,
  idempotencyKey,
  type CallSecret,
} from "./script.js";
import { deriveSecret, generateCode, generatePhrase } from "./secret.js";
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
  /**
   * Directory the attempt reservations live in. Undefined takes the default
   * beside the audit file, null turns reservations off.
   */
  stateDir?: string | null;
  pollIntervalMs?: number;
  now?: () => number;
  /**
   * Operator key material the attempt secret is derived from. Every runner that
   * holds it derives the same code for the same request, so no coordination is
   * needed and no runner can end up checking a call against a code the approver
   * was never shown. Undefined falls back to `makeSecret`, which is a fresh
   * random secret per run.
   */
  codeKey?: Buffer | null;
  makeSecret?: (approver: Approver) => CallSecret;
  onProgress?: (line: string) => void;
  /** Called with the code a person must read back, before the phone rings. */
  onSecret?: (approver: Approver, display: string) => void;
}

/** Clock difference tolerated between this host and the CALL-E timestamps. */
export const CLOCK_SKEW_MS = 60_000;

/**
 * True when the decision landed inside the window this run opened.
 *
 * Two clocks are read and they catch different failures. The local clock catches
 * a result that arrived after the window closed, which is the late approval. The
 * call's own completion time catches a call that finished outside this window
 * altogether, which is what an idempotency key replayed on a later run returns.
 *
 * A completion time the gate cannot read fails closed. Borrowing the local
 * clock's answer instead would let a replay of a call that finished hours ago
 * approve inside a fresh window, which is the one thing the second clock is here
 * to stop. `completionTime` decides what counts as readable.
 */
export function decidedInWindow(options: {
  completedAt: unknown;
  windowStart: number;
  deadline: number;
  now: number;
}): boolean {
  const finished = completionTime(options.completedAt);
  if (finished === null) {
    return false;
  }
  if (options.now > options.deadline) {
    return false;
  }
  return (
    finished >= options.windowStart - CLOCK_SKEW_MS && finished <= options.deadline + CLOCK_SKEW_MS
  );
}

interface PlacedCall {
  call: CallSnapshot | null;
  callId: string | null;
  errorCode: string | null;
  /** The call may exist and the gate could not settle its state. */
  unresolved: boolean;
}

function failureOf(error: unknown): { code: string; ambiguous: boolean } {
  if (error instanceof GateApiError) {
    return { code: error.code, ambiguous: error.ambiguous };
  }
  // An error the adapter could not classify says nothing about the call, so it
  // is read as ambiguous rather than as a request that never landed.
  return { code: "sdk_error", ambiguous: true };
}

function defaultSecret(): CallSecret {
  return { code: generateCode(), phrase: generatePhrase() };
}

/**
 * Create one call and wait for it.
 *
 * A refusal is reported as a failure, because nothing was placed. An error that
 * leaves the call state open is reconciled first: the same idempotency key is
 * replayed, which returns the call CALL-E already has for that key. Only a
 * reconciliation that also fails is reported as an unknown state.
 */
async function placeCall(options: {
  port: CallePort;
  input: CreateCallInput;
  idempotencyKey: string;
  approverId: string;
  timeoutMs: number;
  intervalMs: number;
  progress: (line: string) => void;
}): Promise<PlacedCall> {
  const { port, input, idempotencyKey: key, approverId, progress } = options;
  let created: CallSnapshot;
  try {
    created = await port.createCall(input, key);
  } catch (error) {
    const failure = failureOf(error);
    if (!failure.ambiguous) {
      progress(`CALL-E refused the call for ${approverId} with ${failure.code}. No call was placed.`);
      return { call: null, callId: null, errorCode: failure.code, unresolved: false };
    }
    progress(
      `CALL-E returned ${failure.code} for ${approverId} without saying whether the call exists. Reconciling ${key}.`,
    );
    try {
      created = await port.createCall(input, key);
    } catch (retryError) {
      const second = failureOf(retryError);
      progress(
        `Reconciling ${key} failed with ${second.code}. A call for ${approverId} may be live under that key.`,
      );
      return { call: null, callId: null, errorCode: second.code, unresolved: true };
    }
    progress(`Reconciled ${key} to call ${created.id}.`);
  }
  progress(`Call ${created.id} created for ${approverId}.`);
  try {
    const call = await port.waitForResult(created.id, {
      timeoutMs: options.timeoutMs,
      intervalMs: options.intervalMs,
    });
    return { call, callId: created.id, errorCode: null, unresolved: false };
  } catch (error) {
    if (error instanceof GateTimeoutError) {
      progress(
        `Call ${created.id} did not finish within ${Math.round(options.timeoutMs / 1000)}s.`,
      );
    } else {
      progress(`Polling ${created.id} failed with ${failureOf(error).code}.`);
    }
    // The call exists either way, so its state is read once before the ladder is
    // allowed to move on. A reply is not a settled call: a read that comes back
    // queued, ringing or talking says the approver may still be on the line.
    try {
      const call = await port.getCall(created.id);
      if (!isTerminalCallStatus(call.status)) {
        progress(
          `Call ${created.id} read back as ${call.status}, which is not a finished call. Its state is unresolved.`,
        );
        return {
          call: null,
          callId: created.id,
          errorCode: `call_${call.status}`,
          unresolved: true,
        };
      }
      return { call, callId: created.id, errorCode: null, unresolved: false };
    } catch (readError) {
      const failure = failureOf(readError);
      progress(`Reading ${created.id} failed with ${failure.code}. Its state is unknown.`);
      return { call: null, callId: created.id, errorCode: failure.code, unresolved: true };
    }
  }
}

export async function runGate(options: RunGateOptions): Promise<GateResult> {
  const { request, port } = options;
  const now = options.now ?? (() => Date.now());
  const progress = options.onProgress ?? (() => {});
  const makeSecret = options.makeSecret ?? (() => defaultSecret());
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const auditPath = options.auditPath ?? null;
  const stateDir = options.stateDir === undefined ? defaultStateDir(auditPath) : options.stateDir;

  const windowStart = now();
  const deadline = windowStart + request.policy.windowSeconds * 1000;
  const needed = request.policy.mode === "dual" ? 2 : 1;
  const attempts: AttemptEvaluation[] = [];
  let failures = 0;
  let stopReason: NotApprovedReason | null = null;
  let approvals = 0;

  for (const [index, approver] of request.approvers.entries()) {
    const attemptNumber = index + 1;
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

    // Reserved before the call, so a second run of this request cannot ring the
    // same handset expecting a different code. The reservation is the local layer
    // and the audit trail. Where the runs do not share a filesystem, the derived
    // code is what keeps them agreeing.
    const content = {
      change: request.change,
      policy: request.policy,
      organization: request.organization,
      system: request.system,
      approver,
    };
    const codeKey = options.codeKey ?? null;
    const reserved = reserveSecret({
      dir: stateDir,
      requestId: request.requestId,
      approverId: approver.id,
      attempt: attemptNumber,
      content,
      secret:
        codeKey === null
          ? makeSecret(approver)
          : deriveSecret(codeKey, {
              // The same content the reservation is keyed on, so the code and the
              // reservation cannot end up bound to different requests.
              requestDigest: digestOf(content),
              approverId: approver.id,
              attempt: attemptNumber,
            }),
      reservedAt: new Date(now()).toISOString(),
    });
    const secret = reserved.secret;
    if (!reserved.owned) {
      progress(`Reusing the secret reserved for ${approver.id} at ${reserved.reservedAt}.`);
    }

    const timeoutMs = Math.min(request.policy.perCallTimeoutSeconds * 1000, remainingMs);
    if (request.policy.binding === "code_from_request") {
      options.onSecret?.(approver, codeForRequestChannel(secret));
    }
    progress(`Calling ${approver.name} (${approver.id}), attempt ${attemptNumber}.`);

    const recipient = {
      phones: [approver.phone],
      ...(approver.region === undefined ? {} : { region: approver.region }),
      ...(approver.locale === undefined ? {} : { locale: approver.locale }),
    };
    const input: CreateCallInput = {
      task: buildTask(request, approver, secret),
      recipients: [recipient],
      resultSchema: buildResultSchema(),
      metadata: buildMetadata(request, approver, attemptNumber),
    };

    const placed = await placeCall({
      port,
      input,
      idempotencyKey: idempotencyKey(request, approver, attemptNumber, input),
      approverId: approver.id,
      timeoutMs,
      intervalMs: pollIntervalMs,
      progress,
    });

    const evaluation = evaluateAttempt({
      request,
      approver,
      call: placed.call,
      code: secret.code,
      phrase: secret.phrase,
      apiErrorCode: placed.errorCode,
      callId: placed.callId,
      callStateUnknown: placed.unresolved,
      withinWindow: decidedInWindow({
        completedAt: placed.call?.recipients[0]?.attempts.at(-1)?.completedAt ??
          placed.call?.completedAt ??
          null,
        windowStart,
        deadline,
        now: now(),
      }),
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
    if (evaluation.reason === "call_state_unknown") {
      // A call may be live for this approver. Ringing the next one would put two
      // approvals in flight for one change, so the ladder stops until somebody
      // has reconciled that call.
      stopReason = "call_state_unknown";
      progress(
        `Stopping the ladder. Reconcile ${
          evaluation.call_id ?? "the call under this request's idempotency key"
        } for ${approver.id} before running the gate again.`,
      );
      break;
    }
    if (evaluation.reason === "code_mismatch") {
      // Somebody read a code back and it was not this run's, so this call was
      // set up under a secret this run never had. Another runner may own it and
      // may be acting on it. Walking down the ladder here would ring a second
      // approver behind the first one's back.
      stopReason = "code_mismatch";
      progress(
        `Stopping the ladder. ${
          evaluation.call_id ?? "The call for this attempt"
        } was decided against a code this run does not hold. Reconcile it before running the gate again.`,
      );
      break;
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
  if (auditPath !== null) {
    // The chain is a read and then a write, so the whole section is one lock.
    auditRecordHash = withAuditLock(auditPath, () => {
      const existing = readRecords(auditPath);
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
      appendRecord(auditPath, record);
      return record.hash;
    });
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
