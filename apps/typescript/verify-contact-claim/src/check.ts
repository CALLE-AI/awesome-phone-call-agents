/**
 * One claim, one call, one record.
 *
 * The three refusals ran when the claim file was loaded. They run again here, on the
 * claim and on the script this run is about to send, because the point where a call is
 * placed is the point that has to hold. A claim built any other way than through
 * the loader still cannot dial a number that came out of the contact.
 *
 * A call that cannot be settled is never reported as a call that did not happen. An
 * ambiguous create is replayed under the same idempotency key, which returns the
 * call CALL-E already has for that key rather than ringing the line twice. Once that
 * create is ambiguous, reading the call back is the only thing that resolves it: any
 * failure of the replay leaves the state unknown, whatever class of failure it is.
 */

import { CalleApiError, CalleWaitTimeout, type CallePort } from "./calle.js";
import { ClaimError, sameNumber, sourceProblem } from "./config.js";
import { evaluateCall, maskPhone } from "./decide.js";
import { completionTime, isTerminalCallStatus } from "./evidence.js";
import { whatToDo } from "./format.js";
import {
  appendRecord,
  buildRecord,
  nextSequence,
  previousHash,
  readRecords,
  withRecordLock,
} from "./record.js";
import { impersonationFindings, secretFindings } from "./scan.js";
import { buildCallInput, buildTask, idempotencyKey, questionText } from "./script.js";
import type { CallSnapshot, CheckResult, Claim } from "./types.js";

/** Raised when this run refuses to place the call. Nothing has been sent. */
export class RefusalError extends ClaimError {}

/** Clock difference tolerated between this host and the CALL-E timestamps. */
export const CLOCK_SKEW_MS = 60_000;

/**
 * The refusals that have to hold at the moment of dialling.
 *
 * The loader already refused a claim file with no trust anchor left, one that carries
 * a secret or one that sets a persona. This is the same set of checks on the claim the
 * call is about to be built from, so a claim assembled any other way than through the
 * loader cannot reach the line either.
 *
 * The scan covers the whole task, this app's own rules included, which is why those
 * rules are worded to pass it. See the note above the rules in `script.ts`.
 */
export function preflight(claim: Claim): void {
  if (sameNumber(claim.contact.number_shown, claim.trustedNumber.phone)) {
    throw new RefusalError(
      "The only number this app dials is the trusted one from the claim file and it is the same number that made contact, so there is nothing to verify against. No call was placed.",
    );
  }
  // Every other way the claim can say the number to dial came out of the contact:
  // either the number sitting in one of the contact fields or `printed_on` naming the
  // message as the place it was read.
  const source = sourceProblem(claim.contact, claim.trustedNumber);
  if (source !== null) {
    throw new RefusalError(source);
  }
  const known = [claim.trustedNumber.phone, claim.contact.number_shown];
  if (claim.customer.callback_number !== undefined) {
    // The customer's own number is said out loud on purpose, so it is not a finding.
    known.push(claim.customer.callback_number);
  }
  const script = { script: buildTask(claim), question: questionText(claim) };
  const secret = secretFindings(script, { knownNumbers: known })[0];
  if (secret !== undefined) {
    throw new RefusalError(
      `The call would say what looks like a ${secret.kind} (${secret.masked}) in the ${secret.field}. Nothing the caller asked for is ever repeated, so no call was placed.`,
    );
  }
  const persona = impersonationFindings(script)[0];
  if (persona !== undefined) {
    throw new RefusalError(
      `The call would carry ${persona.kind} in the ${persona.field}. This app never claims to be the customer, so no call was placed.`,
    );
  }
}

/**
 * True when the answer landed inside the window this run opened.
 *
 * Two clocks are read and they catch different things. The local clock catches a
 * result that arrived after this run gave up. The call's own completion time
 * catches a call that finished in an older window altogether, which is what an
 * idempotency key replayed on a later run returns.
 *
 * A completion time that cannot be read fails closed. Falling back on the local
 * clock would let a replay of a call that finished hours ago answer inside a fresh
 * window, which is the one thing the second clock is here to stop.
 */
export function answeredInWindow(options: {
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
  return finished >= options.windowStart - CLOCK_SKEW_MS && finished <= options.deadline + CLOCK_SKEW_MS;
}

interface PlacedCall {
  call: CallSnapshot | null;
  callId: string | null;
  errorCode: string | null;
  /** The call may exist and this app could not settle its state. */
  unresolved: boolean;
}

function failureOf(error: unknown): { code: string; ambiguous: boolean } {
  if (error instanceof CalleWaitTimeout) {
    // The wait gave up. The call is still CALL-E's and may still be talking.
    return { code: "wait_timeout", ambiguous: true };
  }
  if (error instanceof CalleApiError) {
    return { code: error.code, ambiguous: error.ambiguous };
  }
  // An error the adapter could not classify says nothing about the call, so it is
  // read as ambiguous rather than as a request that never landed.
  return { code: "sdk_error", ambiguous: true };
}

/** Both failures, in order, so a record names what actually happened rather than the last of it. */
function chain(first: string, second: string): string {
  return `${first}, then ${second}`;
}

async function placeCall(options: {
  port: CallePort;
  claim: Claim;
  timeoutMs: number;
  intervalMs: number;
  progress: (line: string) => void;
}): Promise<PlacedCall> {
  const { port, claim, progress } = options;
  const input = buildCallInput(claim);
  const key = idempotencyKey(claim);
  let created: CallSnapshot;
  try {
    created = await port.createCall(input, key);
  } catch (error) {
    const failure = failureOf(error);
    if (!failure.ambiguous) {
      progress(`CALL-E refused the call with ${failure.code}. No call was placed.`);
      return { call: null, callId: null, errorCode: failure.code, unresolved: false };
    }
    progress(`CALL-E returned ${failure.code} without saying whether the call exists. Reconciling ${key}.`);
    try {
      created = await port.createCall(input, key);
    } catch (retryError) {
      // Reading the call back is the only thing that can resolve an ambiguous create.
      // The class of this second failure says nothing about the first request: that
      // one may already have been accepted. A 401 or a 403 here can be decided before
      // the idempotency key is ever looked up. So every failure of the replay leaves
      // the state unknown and both codes go into the record.
      const second = failureOf(retryError);
      progress(`Reconciling ${key} failed with ${second.code}. A call may be live under that key.`);
      return { call: null, callId: null, errorCode: chain(failure.code, second.code), unresolved: true };
    }
    progress(`Reconciled ${key} to call ${created.id}.`);
  }
  progress(`Call ${created.id} created.`);
  try {
    const call = await port.waitForResult(created.id, {
      timeoutMs: options.timeoutMs,
      intervalMs: options.intervalMs,
    });
    return { call, callId: created.id, errorCode: null, unresolved: false };
  } catch (error) {
    const waited = failureOf(error);
    progress(
      error instanceof CalleWaitTimeout
        ? `Call ${created.id} did not finish within ${Math.round(options.timeoutMs / 1000)}s.`
        : `Polling ${created.id} failed with ${waited.code}.`,
    );
    // The call exists either way, so its state is read once. A reply is not a
    // settled call: a read that comes back queued or in progress says the line may
    // still be open, so the answer is unknown rather than absent.
    try {
      const call = await port.getCall(created.id);
      if (!isTerminalCallStatus(call.status)) {
        progress(`Call ${created.id} read back as ${call.status || "no status"}, which is not a finished call.`);
        return {
          call: null,
          callId: created.id,
          errorCode: chain(waited.code, `call_${call.status}`),
          unresolved: true,
        };
      }
      return { call, callId: created.id, errorCode: null, unresolved: false };
    } catch (readError) {
      const failure = failureOf(readError);
      progress(`Reading ${created.id} failed with ${failure.code}. Its state is unknown.`);
      return { call: null, callId: created.id, errorCode: chain(waited.code, failure.code), unresolved: true };
    }
  }
}

export interface RunCheckOptions {
  claim: Claim;
  port: CallePort;
  /** Where the record goes. Null keeps no record, which a live run never does. */
  recordPath?: string | null;
  pollIntervalMs?: number;
  now?: () => number;
  onProgress?: (line: string) => void;
}

export async function runCheck(options: RunCheckOptions): Promise<CheckResult> {
  const { claim, port } = options;
  const now = options.now ?? (() => Date.now());
  const progress = options.onProgress ?? (() => {});
  const recordPath = options.recordPath ?? null;

  preflight(claim);

  const question = questionText(claim);
  const windowStart = now();
  const deadline = windowStart + claim.policy.perCallTimeoutSeconds * 1000;
  progress(`Calling ${claim.contact.claimed_to_be} on ${maskPhone(claim.trustedNumber.phone)}, from ${claim.trustedNumber.printed_on}.`);

  const placed = await placeCall({
    port,
    claim,
    timeoutMs: claim.policy.perCallTimeoutSeconds * 1000,
    intervalMs: options.pollIntervalMs ?? 2000,
    progress,
  });

  const attempt = placed.call?.recipients[0]?.attempts.at(-1) ?? null;
  const evaluation = evaluateCall({
    claim,
    question,
    call: placed.call,
    apiErrorCode: placed.errorCode,
    callId: placed.callId,
    callStateUnknown: placed.unresolved,
    answeredInWindow: answeredInWindow({
      completedAt: attempt?.completedAt ?? placed.call?.completedAt ?? null,
      windowStart,
      deadline,
      now: now(),
    }),
  });
  progress(`Outcome ${evaluation.outcome}${evaluation.reason === null ? "" : ` (${evaluation.reason})`}.`);

  let recordHash: string | null = null;
  if (recordPath !== null) {
    // The chain is a read and then a write, so the whole section is one lock.
    recordHash = withRecordLock(recordPath, () => {
      const existing = readRecords(recordPath);
      const record = buildRecord({
        claim,
        question,
        dialled: claim.trustedNumber.phone,
        evaluation,
        previousHash: previousHash(existing),
        sequence: nextSequence(existing),
        recordedAt: new Date(now()).toISOString(),
      });
      appendRecord(recordPath, record);
      return record.hash;
    });
  }

  return {
    claim_id: claim.claimId,
    outcome: evaluation.outcome,
    reason: evaluation.reason,
    question,
    callee_quote: evaluation.quote,
    dialled_masked: maskPhone(claim.trustedNumber.phone),
    use_number: maskPhone(claim.trustedNumber.phone),
    use_number_printed_on: claim.trustedNumber.printed_on,
    what_to_do: whatToDo(evaluation.outcome, claim),
    evidence: evaluation.evidence,
    transcript_excerpt: evaluation.excerpt,
    transcript: evaluation.transcript,
    callee_note: evaluation.calleeNote,
    call_id: evaluation.callId,
    provider_call_id: evaluation.providerCallId,
    started_at: evaluation.startedAt,
    completed_at: evaluation.completedAt,
    record_hash: recordHash,
  };
}
