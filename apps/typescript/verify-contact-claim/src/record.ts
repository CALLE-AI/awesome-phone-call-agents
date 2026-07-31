/**
 * Hash-chained records of what was asked and what came back.
 *
 * The record is the evidence a customer or their bank can be shown later, so it
 * carries the inputs the outcome was computed from rather than only the outcome.
 * Verification then does four separate things:
 *
 * it re-links the chain, so a record cannot be dropped or reordered;
 * it re-reads the signal from the stored callee turns, so the words have to still
 * say what the record claims they said;
 * it recomputes the outcome with the same function that ran live, so a verdict
 * edited by hand fails even when the chain is intact;
 * it checks the number that was dialled against the trusted number in the claim,
 * because the first refusal is the one somebody would most want to hide.
 *
 * What the record does not carry: a full phone number, the caller's own script and
 * what the message asked the customer to do. Numbers are masked for reading plus
 * digested for checking. The digest is salted with the claim id, so digests cannot
 * be compared across claims.
 */

import {
  closeSync,
  existsSync,
  fchmodSync,
  fstatSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { digitsOf } from "./config.js";
import { maskPhone, outcomeFrom, type CallEvaluation } from "./decide.js";
import { signalFromLine, signalFromLines } from "./evidence.js";
import { digestOf, sha256 } from "./hash.js";
import { claimDigest } from "./script.js";
import type { Claim, ClaimRecord, RecordIssue, RecordVerification, RecordedClaim } from "./types.js";

export const GENESIS_HASH = "sha256:0000000000000000000000000000000000000000000000000000000000000000";

/** Mode a record file is held at. Re-applied on every append, not only on create. */
export const RECORD_MODE = 0o600;

/**
 * A number as a digest that can be checked without storing the number.
 *
 * The claim id is mixed in, so the same handset in two claims gives two digests
 * and a digest cannot be used to link records together.
 */
export function numberDigest(claimId: string, phone: string): string {
  return sha256(`${claimId}:${digitsOf(phone)}`);
}

export function recordedClaim(claim: Claim): RecordedClaim {
  return {
    claimed_to_be: claim.contact.claimed_to_be,
    channel: claim.contact.channel,
    arrived_at: claim.contact.arrived_at,
    claimed_about: claim.contact.claimed_about,
    recent_window_minutes: claim.policy.recentWindowMinutes,
    number_shown_masked: maskPhone(claim.contact.number_shown),
    number_shown_digest: numberDigest(claim.claimId, claim.contact.number_shown),
    trusted_number_masked: maskPhone(claim.trustedNumber.phone),
    trusted_number_digest: numberDigest(claim.claimId, claim.trustedNumber.phone),
    trusted_printed_on: claim.trustedNumber.printed_on,
    callback_number_masked:
      claim.customer.callback_number === undefined ? null : maskPhone(claim.customer.callback_number),
  };
}

export function hashRecord(record: Omit<ClaimRecord, "hash">): string {
  return digestOf(record);
}

export function buildRecord(options: {
  claim: Claim;
  question: string;
  /** The number this run actually dialled, so verification can check it. */
  dialled: string;
  evaluation: CallEvaluation;
  previousHash: string;
  sequence: number;
  recordedAt: string;
}): ClaimRecord {
  const { claim, evaluation } = options;
  const unhashed: Omit<ClaimRecord, "hash"> = {
    seq: options.sequence,
    recorded_at: options.recordedAt,
    claim_id: claim.claimId,
    claim_digest: claimDigest(claim),
    claim: recordedClaim(claim),
    question: options.question,
    outcome: evaluation.outcome,
    reason: evaluation.reason,
    callee_quote: evaluation.quote,
    transcript_excerpt: evaluation.excerpt,
    evidence: evaluation.evidence,
    dialled_digest: numberDigest(claim.claimId, options.dialled),
    dialled_masked: maskPhone(options.dialled),
    min_confidence: claim.policy.minConfidence,
    call_id: evaluation.callId,
    provider_call_id: evaluation.providerCallId,
    started_at: evaluation.startedAt,
    completed_at: evaluation.completedAt,
    prev_hash: options.previousHash,
  };
  return { ...unhashed, hash: hashRecord(unhashed) };
}

export function readRecords(path: string): ClaimRecord[] {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ClaimRecord);
}

/**
 * Append one record, at 0600, to a regular file.
 *
 * A mode handed to open only applies when open creates the file, so a record file
 * that already existed kept whatever mode it had while the docs promised 0600. The
 * descriptor is chmodded instead: it covers both cases and it cannot be pointed at
 * another path between the check and the write.
 *
 * A file other accounts can already read is refused rather than quietly tightened.
 * It holds what somebody said about a customer's account, so the exposure has
 * already happened and only the operator can decide what to do about it.
 */
export function appendRecord(path: string, record: ClaimRecord): void {
  const fd = openSync(path, "a", RECORD_MODE);
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile()) {
      throw new Error(`${path} is not a regular file, so no record was appended.`);
    }
    const mode = stats.mode & 0o777;
    if ((mode & 0o077) !== 0) {
      throw new Error(
        `Record file ${path} is mode 0${mode.toString(8)}, which other accounts can read. It holds what somebody said about a customer's account, so nothing was appended. Run chmod 600 ${path} then run this again.`,
      );
    }
    fchmodSync(fd, RECORD_MODE);
    writeSync(fd, `${JSON.stringify(record)}\n`);
  } finally {
    closeSync(fd);
  }
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
 * Adding a record is a read and then a write: the new record needs the tail's hash
 * and its sequence number. Two runs appending at once would both read the same tail
 * and both claim the same place in the chain, which verification then reports as a
 * broken chain. The lock is a file created with O_CREAT and O_EXCL beside the
 * record file, so the filesystem decides who goes first. A lock left behind by a
 * killed run is broken once it is older than `staleMs`.
 */
export function withRecordLock<T>(
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

export function nextSequence(records: ClaimRecord[]): number {
  return records.length === 0 ? 1 : (records.at(-1)?.seq ?? 0) + 1;
}

export function previousHash(records: ClaimRecord[]): string {
  return records.at(-1)?.hash ?? GENESIS_HASH;
}

export function verifyRecords(records: ClaimRecord[]): RecordVerification {
  const issues: RecordIssue[] = [];
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
    if (hashRecord(unhashed) !== hash) {
      issues.push({ seq, problem: "hash does not match the record contents" });
    }

    // The words have to still say what the record says they said.
    const rederived = signalFromLines(record.transcript_excerpt);
    if (rederived !== record.evidence.signal) {
      issues.push({
        seq,
        problem: `signal ${record.evidence.signal} is not what the callee turns say (${rederived})`,
      });
    }
    if (record.callee_quote.length > 0) {
      if (!record.transcript_excerpt.includes(record.callee_quote)) {
        issues.push({ seq, problem: "the quote is not one of the recorded turns" });
      }
      const fromQuote = signalFromLine(record.callee_quote);
      if (fromQuote !== record.evidence.signal) {
        issues.push({
          seq,
          problem: `signal ${record.evidence.signal} is not what the callee turns say (${fromQuote} in the quote)`,
        });
      }
    } else if (record.evidence.signal !== "unclear") {
      issues.push({ seq, problem: `signal ${record.evidence.signal} is recorded with nothing quoted for it` });
    }

    // The outcome, replayed by the function that decided it live.
    const replayed = outcomeFrom(record.evidence, { minConfidence: record.min_confidence });
    if (replayed.outcome !== record.outcome || replayed.reason !== record.reason) {
      issues.push({
        seq,
        problem: `outcome ${record.outcome}/${String(record.reason)} does not follow from the recorded evidence (${replayed.outcome}/${String(replayed.reason)})`,
      });
    }

    // The first refusal, checked after the fact.
    if (record.dialled_digest !== record.claim.trusted_number_digest) {
      const shown = record.dialled_digest === record.claim.number_shown_digest;
      issues.push({
        seq,
        problem: shown
          ? "the number dialled was not the trusted number, it was the number that made contact"
          : "the number dialled was not the trusted number from the claim",
      });
    }

    expectedPrevious = hash;
    expectedSequence += 1;
  }

  return { ok: issues.length === 0, records: records.length, issues };
}

export function verifyRecord(path: string): RecordVerification {
  return verifyRecords(readRecords(path));
}
