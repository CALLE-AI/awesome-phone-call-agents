/**
 * Hash-chained approval records.
 *
 * A change-approval record is only worth keeping if it can be checked. Every
 * record carries the inputs the outcome was computed from, so verification does
 * three separate things: it re-links the chain, it recomputes the decision from
 * the recorded excerpt and it recomputes the outcome and verdict from the
 * recorded inputs with the same function the gate used live. A record whose
 * verdict was edited by hand fails on the third check even when the chain is
 * valid, which a plain append-only log cannot catch.
 */

import { appendFileSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { attemptOutcome, decisionFromExcerpt, verdictFromAttempts } from "./decide.js";
import type {
  ApprovalRequest,
  AttemptEvaluation,
  AuditIssue,
  AuditPolicy,
  AuditRecord,
  AuditVerification,
  NotApprovedReason,
  Policy,
  Verdict,
} from "./types.js";

export const GENESIS_HASH = "sha256:0000000000000000000000000000000000000000000000000000000000000000";

/** Stable JSON with sorted keys, so a hash depends on values and not key order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

function sha256(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

export function digestOf(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function auditPolicy(policy: Policy): AuditPolicy {
  return {
    mode: policy.mode,
    binding: policy.binding,
    per_call_timeout_seconds: policy.perCallTimeoutSeconds,
    window_seconds: policy.windowSeconds,
    min_confidence: policy.minConfidence,
    max_failed_attempts: policy.maxFailedAttempts,
  };
}

function policyFromAudit(policy: AuditPolicy): Policy {
  return {
    mode: policy.mode,
    binding: policy.binding,
    perCallTimeoutSeconds: policy.per_call_timeout_seconds,
    windowSeconds: policy.window_seconds,
    minConfidence: policy.min_confidence,
    maxFailedAttempts: policy.max_failed_attempts,
  };
}

export function readRecords(path: string): AuditRecord[] {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as AuditRecord);
}

export function hashRecord(record: Omit<AuditRecord, "hash">): string {
  return digestOf(record);
}

export function buildRecord(options: {
  request: ApprovalRequest;
  attempts: AttemptEvaluation[];
  verdict: Verdict;
  reason: NotApprovedReason | null;
  approvedBy: string[];
  previousHash: string;
  sequence: number;
  recordedAt: string;
}): AuditRecord {
  const unhashed: Omit<AuditRecord, "hash"> = {
    seq: options.sequence,
    recorded_at: options.recordedAt,
    request_id: options.request.requestId,
    request_digest: digestOf({
      change: options.request.change,
      policy: auditPolicy(options.request.policy),
      approvers: options.request.approvers.map((approver) => approver.id),
    }),
    change: options.request.change,
    policy: auditPolicy(options.request.policy),
    secret_delivery:
      options.request.policy.binding === "code_from_request" ? "request_channel" : "spoken_on_call",
    attempts: options.attempts,
    verdict: options.verdict,
    reason: options.reason,
    approved_by: options.approvedBy,
    prev_hash: options.previousHash,
  };
  return { ...unhashed, hash: hashRecord(unhashed) };
}

export function appendRecord(path: string, record: AuditRecord): void {
  appendFileSync(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
}

/** How long a lock file may sit before it is treated as abandoned. */
export const LOCK_STALE_MS = 30_000;
/** How long a run waits for another run to finish its append. */
export const LOCK_WAIT_MS = 10_000;

/** Block without spinning the event loop. The guarded section is synchronous. */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run an append under an exclusive lock.
 *
 * Adding a record is a read and then a write: the new record needs the tail's
 * hash and its sequence number. Two runs appending at the same time would both
 * read the same tail and both claim the same place in the chain, which
 * verification then reports as a broken chain. The lock is a file created with
 * O_CREAT and O_EXCL beside the record file, so the filesystem decides who goes
 * first rather than a read-then-write race. A lock left behind by a killed run
 * is broken once it is older than `staleMs`. It is one filesystem and one
 * advisory lock, not a distributed one: two runners with their own copy of the
 * file still need their own record files.
 */
export function withAuditLock<T>(
  path: string,
  body: () => T,
  options: { waitMs?: number; staleMs?: number } = {},
): T {
  const lockPath = `${path}.lock`;
  const waitMs = options.waitMs ?? LOCK_WAIT_MS;
  const staleMs = options.staleMs ?? LOCK_STALE_MS;
  const giveUpAt = Date.now() + waitMs;
  for (;;) {
    try {
      writeFileSync(lockPath, `${process.pid} ${new Date().toISOString()}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      let heldForMs = 0;
      try {
        heldForMs = Date.now() - statSync(lockPath).mtimeMs;
      } catch {
        continue; // The holder released it while we looked.
      }
      if (heldForMs > staleMs) {
        rmSync(lockPath, { force: true });
        continue;
      }
      if (Date.now() >= giveUpAt) {
        throw new Error(
          `Another run holds ${lockPath} and did not release it within ${waitMs}ms. Nothing was appended to ${path}.`,
        );
      }
      pause(25);
    }
  }
  try {
    return body();
  } finally {
    rmSync(lockPath, { force: true });
  }
}

export function nextSequence(records: AuditRecord[]): number {
  return records.length === 0 ? 1 : (records.at(-1)?.seq ?? 0) + 1;
}

export function previousHash(records: AuditRecord[]): string {
  return records.at(-1)?.hash ?? GENESIS_HASH;
}

export function verifyRecords(records: AuditRecord[]): AuditVerification {
  const issues: AuditIssue[] = [];
  let expectedPrevious = GENESIS_HASH;
  let expectedSequence = 1;

  for (const record of records) {
    const seq = record.seq;
    if (record.seq !== expectedSequence) {
      issues.push({ seq, problem: `sequence should be ${expectedSequence}` });
    }
    if (record.prev_hash !== expectedPrevious) {
      issues.push({ seq, problem: "prev_hash does not match the previous record" });
    }
    const { hash, ...unhashed } = record;
    const recomputed = hashRecord(unhashed);
    if (recomputed !== hash) {
      issues.push({ seq, problem: "hash does not match the record contents" });
    }

    const policy = policyFromAudit(record.policy);
    for (const attempt of record.attempts) {
      const recordedDecision = attempt.evidence.decision;
      const recordedCodeMatch = attempt.evidence.code_match;
      const expectedCodeMatch =
        attempt.spoken_secret_digest !== null && attempt.spoken_secret_digest === attempt.secret_digest;
      if (recordedCodeMatch !== expectedCodeMatch) {
        issues.push({
          seq,
          problem: `attempt ${attempt.approver_id}: code_match does not match the secret digests`,
        });
      }
      if (attempt.evidence.transcript_available && attempt.transcript_excerpt.length > 0) {
        const rederived = decisionFromExcerpt(attempt.transcript_excerpt);
        if (rederived !== recordedDecision) {
          issues.push({
            seq,
            problem: `attempt ${attempt.approver_id}: decision ${recordedDecision} is not what the excerpt says (${rederived})`,
          });
        }
      }
      const outcome = attemptOutcome(attempt.evidence, policy);
      if (outcome.outcome !== attempt.outcome || outcome.reason !== attempt.reason) {
        issues.push({
          seq,
          problem: `attempt ${attempt.approver_id}: outcome ${attempt.outcome}/${String(attempt.reason)} does not follow from the recorded evidence (${outcome.outcome}/${String(outcome.reason)})`,
        });
      }
    }

    const folded = verdictFromAttempts(record.attempts, policy);
    const windowStop = record.reason === "window_expired" || record.reason === "attempt_limit";
    if (folded.verdict !== record.verdict && !(windowStop && record.verdict === "not_approved")) {
      issues.push({
        seq,
        problem: `verdict ${record.verdict} does not follow from the recorded attempts (${folded.verdict})`,
      });
    }
    if (canonicalJson(folded.approvedBy) !== canonicalJson(record.approved_by)) {
      issues.push({ seq, problem: "approved_by does not follow from the recorded attempts" });
    }

    expectedPrevious = hash;
    expectedSequence += 1;
  }

  return { ok: issues.length === 0, records: records.length, issues };
}

export function verifyAudit(path: string): AuditVerification {
  return verifyRecords(readRecords(path));
}
