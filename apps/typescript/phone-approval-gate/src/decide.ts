/**
 * Fail-closed decision logic.
 *
 * Two rules carry the design.
 *
 * The transcript is authoritative and the extracted result is corroboration
 * only. CALL-E's own `structured_result` can be null on a call that went
 * perfectly, so a gate that needed it would fail for the wrong reason and a gate
 * that trusted it alone would approve a production change on a summary. This
 * gate reads the recipient turns itself, then refuses to approve when the
 * extracted decision contradicts what it read. A call that came back with no
 * recipient turns has nothing to corroborate, so it cannot approve at all.
 *
 * Silence is never approval. A machine answering, an empty transcript, a
 * missing code, a code the gate does not hold, a low completion confidence, a
 * result that landed outside the approval window, an API failure and a call
 * whose state could not be settled all land on `not_approved` with a reason. The
 * only path to `approved` is a person who returned the secret and said yes,
 * inside the window.
 */

import { redactSecret, secretDigest } from "./secret.js";
import { decisionFromLines, looksLikeMachine, readTranscript } from "./transcript.js";
import type {
  ApprovalRequest,
  Approver,
  AttemptEvaluation,
  CallSnapshot,
  Confidence,
  Decision,
  NotApprovedReason,
  OutcomeInputs,
  Policy,
  Verdict,
} from "./types.js";

const NO_ANSWER_HINTS = ["no_answer", "noanswer", "busy", "unreachable", "declined", "rejected_by_recipient", "not_answered"];
const MACHINE_HINTS = ["voicemail", "machine", "ivr", "answering"];

/**
 * The statuses CALL-E ends a call on.
 *
 * This is the whole of `CallStatus` in the Developer API schema that ends a
 * call: `queued` and `in_progress` are the other two values it can hold. A no
 * answer, a busy line or a voicemail arrives as `failed` with a failure code
 * rather than as a status of its own, so those are read from the code and are
 * deliberately not in this set.
 *
 * Everything else (queued, in_progress, a status this gate has never seen) means
 * the call may still be talking to the approver, so it can never resolve an
 * attempt. The set lives here because both readers need the same answer: the
 * gate reads a call back after a poll gave up and this module turns a status into
 * an outcome. Two copies would drift and a drift here rings a second handset over
 * a live call.
 */
export const TERMINAL_CALL_STATUSES = new Set(["completed", "failed", "canceled"]);

export function isTerminalCallStatus(status: string): boolean {
  return TERMINAL_CALL_STATUSES.has(status.trim().toLowerCase());
}

/**
 * The provider's completion time as milliseconds, or null when it cannot be
 * used.
 *
 * A JSON field arrives as whatever the provider sent, so this is the one place
 * that decides whether there is a usable timestamp at all. Missing, null, empty,
 * unparseable and the wrong type all come back null, and null fails closed
 * everywhere it is read: without the call's own clock the gate cannot tell a
 * decision made in this window from an idempotent replay of a call that finished
 * in an older one.
 */
export function completionTime(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  if (text.length === 0) {
    return null;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function hints(code: string | null, table: string[]): boolean {
  if (code === null) {
    return false;
  }
  const value = code.toLowerCase();
  return table.some((hint) => value.includes(hint));
}

function readDecision(value: unknown): Decision | null {
  if (value === "approve" || value === "reject" || value === "unknown") {
    return value;
  }
  return null;
}

/**
 * The single place an attempt outcome is decided. The gate calls it live and
 * the audit verifier calls it again on the recorded inputs, so a record whose
 * verdict was edited by hand fails verification even when its hash chain is
 * intact.
 */
export function attemptOutcome(
  inputs: OutcomeInputs,
  policy: Policy,
): { outcome: Verdict; reason: NotApprovedReason | null } {
  if (inputs.decision === "reject" || inputs.structured_decision === "reject") {
    return { outcome: "rejected", reason: null };
  }
  if (inputs.call_status === "state_unknown") {
    // A create or a poll that could not be settled. A call may be live, so this
    // is neither an approval nor a clean failure and the ladder stops on it.
    return { outcome: "not_approved", reason: "call_state_unknown" };
  }
  if (inputs.call_status === "api_error") {
    // CALL-E refused the request, so no call reached a handset.
    return { outcome: "not_approved", reason: "api_error" };
  }
  if (!isTerminalCallStatus(inputs.call_status)) {
    // Still queued or in progress. The call may be live, so nothing in this
    // snapshot resolves the attempt, whatever else the snapshot carries. The
    // ladder stops on it.
    return { outcome: "not_approved", reason: "call_state_unknown" };
  }
  if (inputs.call_status !== "completed") {
    // The call is over and nobody decided. The status and the failure code are
    // read the same way, because a provider can put the same fact in either.
    if (hints(inputs.failure_code, MACHINE_HINTS) || hints(inputs.call_status, MACHINE_HINTS)) {
      return { outcome: "not_approved", reason: "voicemail" };
    }
    if (hints(inputs.failure_code, NO_ANSWER_HINTS) || hints(inputs.call_status, NO_ANSWER_HINTS)) {
      return { outcome: "not_approved", reason: "no_answer" };
    }
    return { outcome: "not_approved", reason: "call_failed" };
  }
  if (inputs.machine_answered) {
    return { outcome: "not_approved", reason: "voicemail" };
  }
  if (!inputs.completion_time_usable) {
    // The call says it completed and gives no usable time for it. Recorded on its
    // own rather than as an expired window, because the window is not what
    // failed: the provider's clock is missing and a replayed call cannot be told
    // apart from a fresh one without it.
    return { outcome: "not_approved", reason: "completion_time_unknown" };
  }
  if (!inputs.within_window) {
    // The decision landed outside the window this run opened, either late or on
    // a call from an earlier run. An approval that outlives its request is
    // worse than no approval.
    return { outcome: "not_approved", reason: "window_expired" };
  }
  if (!inputs.transcript_available) {
    return { outcome: "not_approved", reason: "no_transcript_evidence" };
  }
  if (!inputs.reached_person) {
    return { outcome: "not_approved", reason: "not_reached" };
  }
  if (!inputs.code_match) {
    if (inputs.unmatched_code_spoken) {
      // A person read a code back and it is not the one this run holds, so this
      // call was set up under a secret this run never had. Another runner may own
      // it. Not an approval and not a clean failure either, so the ladder stops
      // on it instead of ringing the next approver behind that person's back.
      return { outcome: "not_approved", reason: "code_mismatch" };
    }
    // Nobody returned the secret. A bare yes is not an approval.
    return { outcome: "not_approved", reason: "secret_not_returned" };
  }
  if (inputs.decision !== "approve") {
    return { outcome: "not_approved", reason: "no_decision" };
  }
  if (inputs.structured_decision !== null && inputs.structured_decision !== "approve") {
    return { outcome: "not_approved", reason: "disagreement" };
  }
  if (inputs.confidence !== null && inputs.confidence.score < policy.minConfidence) {
    return { outcome: "not_approved", reason: "low_confidence" };
  }
  return { outcome: "approved", reason: null };
}

/** Mask a number for logs and records. Keeps the country code and last two digits. */
export function maskPhone(phone: string): string {
  if (phone.length <= 5) {
    return "***";
  }
  const head = phone.slice(0, 3);
  const tail = phone.slice(-2);
  return `${head}${"*".repeat(Math.max(phone.length - 5, 1))}${tail}`;
}

export function evaluateAttempt(options: {
  request: ApprovalRequest;
  approver: Approver;
  call: CallSnapshot | null;
  code: string;
  phrase: string[];
  apiErrorCode?: string | null;
  /** Set when a create or a poll left a call that may be running. */
  callStateUnknown?: boolean;
  /** The call id, when it is known even though no snapshot came back. */
  callId?: string | null;
  /** False when the decision landed outside this run's approval window. */
  withinWindow?: boolean;
}): AttemptEvaluation {
  const { request, approver, call, code, phrase } = options;
  const policy = request.policy;
  const withinWindow = options.withinWindow ?? true;
  const expectedSecret = policy.binding === "code_from_request" ? code : phrase.join(" ");
  const digest = secretDigest(request.requestId, expectedSecret);
  const base = {
    approver_id: approver.id,
    phone_masked: maskPhone(approver.phone),
    secret_digest: digest,
  };

  if (call === null) {
    // Two different situations. The record has to tell them apart. CALL-E
    // refusing the request means no call happened. A create or a poll that
    // could not be settled means a call may be live under the same key.
    const evidence: OutcomeInputs = {
      call_status: options.callStateUnknown === true ? "state_unknown" : "api_error",
      failure_code: options.apiErrorCode ?? null,
      reached_person: false,
      machine_answered: false,
      within_window: withinWindow,
      // No call came back, so there is no completion time to read.
      completion_time_usable: false,
      transcript_available: false,
      code_match: false,
      unmatched_code_spoken: false,
      decision: "unknown",
      structured_decision: null,
      confidence: null,
    };
    const noCall = attemptOutcome(evidence, policy);
    return {
      ...base,
      call_id: options.callId ?? null,
      provider_call_id: null,
      outcome: noCall.outcome,
      reason: noCall.reason,
      evidence,
      spoken_secret_digest: null,
      transcript_excerpt: [],
      started_at: null,
      completed_at: null,
    };
  }

  const recipient = call.recipients[0] ?? null;
  const attempt = recipient?.attempts.at(-1) ?? null;
  const turns = attempt?.transcriptTurns ?? [];
  const reading = readTranscript(turns, { binding: policy.binding, code, phrase });
  const structured = call.structuredResult ?? recipient?.structuredResult ?? null;
  const structuredDecision = structured === null ? null : readDecision(structured.decision);

  const machineAnswered = looksLikeMachine(turns) && reading.decisionSignal === "unknown";
  const transcriptAvailable = turns.length > 0;
  const reachedPerson = reading.userTurnCount > 0 && !machineAnswered;

  const codeMatch = reading.secretSpoken;
  // A code came back and it was not this run's. The binding matters: in phrase
  // mode nothing is read off the request channel, so there is no other code to
  // confuse this one with.
  const unmatchedCodeSpoken =
    !codeMatch && policy.binding === "code_from_request" && reading.spokenDigits !== null;
  let spokenSecretDigest: string | null = null;
  if (codeMatch) {
    spokenSecretDigest = digest;
  } else if (unmatchedCodeSpoken && reading.spokenDigits !== null) {
    spokenSecretDigest = secretDigest(request.requestId, reading.spokenDigits);
  }

  // The extracted result is read for corroboration and never stands in for the
  // transcript. Whatever it says, an approval has to come from a recipient turn
  // this gate read itself.
  const decision = reading.decisionSignal;

  const confidence: Confidence | null = call.completionConfidence ?? null;
  // Read from the same field the window check reads, so a record cannot claim the
  // window was checked against a time the gate could not use.
  const completionUsable = completionTime(attempt?.completedAt ?? call.completedAt) !== null;
  const evidence: OutcomeInputs = {
    call_status: call.status,
    failure_code: attempt?.failureCode ?? call.failureCode ?? null,
    reached_person: reachedPerson,
    machine_answered: machineAnswered,
    // A window cannot be judged against a time the gate could not read, so the
    // two facts move together in a record and never contradict each other.
    within_window: withinWindow && completionUsable,
    completion_time_usable: completionUsable,
    transcript_available: transcriptAvailable,
    code_match: codeMatch,
    unmatched_code_spoken: unmatchedCodeSpoken,
    decision,
    structured_decision: structuredDecision,
    confidence,
  };
  const { outcome, reason } = attemptOutcome(evidence, policy);

  // The secret never reaches the record. What is kept is the decision language
  // plus the digests, which is what verification needs.
  const excerpt = reading.excerpt.map((line) =>
    redactSecret(line, code, policy.binding === "liveness_phrase" ? phrase : []),
  );

  return {
    ...base,
    call_id: call.id,
    provider_call_id: attempt?.providerCallId ?? null,
    outcome,
    reason,
    evidence,
    spoken_secret_digest: spokenSecretDigest,
    transcript_excerpt: excerpt,
    started_at: attempt?.startedAt ?? call.createdAt,
    completed_at: attempt?.completedAt ?? call.completedAt,
  };
}

/**
 * Fold attempt outcomes into one verdict. A rejection anywhere is final, so an
 * escalation ladder cannot walk past a person who said no. Dual control needs
 * two approvals from two different enrolled approvers.
 */
export function verdictFromAttempts(
  attempts: AttemptEvaluation[],
  policy: Policy,
): { verdict: Verdict; reason: NotApprovedReason | null; approvedBy: string[] } {
  const rejected = attempts.find((attempt) => attempt.outcome === "rejected");
  if (rejected !== undefined) {
    return { verdict: "rejected", reason: null, approvedBy: [] };
  }
  const approvedBy = [
    ...new Set(
      attempts.filter((attempt) => attempt.outcome === "approved").map((attempt) => attempt.approver_id),
    ),
  ];
  const needed = policy.mode === "dual" ? 2 : 1;
  if (approvedBy.length >= needed) {
    return { verdict: "approved", reason: null, approvedBy };
  }
  if (approvedBy.length > 0) {
    return { verdict: "not_approved", reason: "quorum_not_met", approvedBy };
  }
  const last = attempts.at(-1);
  return {
    verdict: "not_approved",
    reason: last?.reason ?? "not_reached",
    approvedBy: [],
  };
}

/** Decision re-read from the recorded excerpt, used by audit verification. */
export function decisionFromExcerpt(lines: string[]): Decision {
  return decisionFromLines(lines);
}
