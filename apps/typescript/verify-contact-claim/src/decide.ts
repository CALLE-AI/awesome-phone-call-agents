/**
 * The five outcomes, decided in one place.
 *
 * `outcomeFrom` takes the inputs an outcome depends on and returns the outcome.
 * The app calls it live and record verification calls it again on the stored
 * inputs, so a record whose outcome was edited by hand fails verification even
 * when its hash chain is intact.
 *
 * Everything about it fails closed. A verdict comes only from a terminal call
 * status. An answer comes only from a callee turn that supports it, after our
 * question was asked. CALL-E's own reading corroborates that turn and never
 * replaces it, so the two disagreeing is not an answer. Two more cases are not
 * answers either: a call whose completion time cannot be read at all, then a call
 * whose answer landed outside the window this run opened.
 *
 * `refused_to_confirm` is not a failure. An institution that will not discuss a
 * third party's account is complying with the rules it is under, so the app records
 * that as an answer of its own and still hands back the number on the card.
 */

import { completionTime, isTerminalCallStatus, readTranscript } from "./evidence.js";
import type {
  CallSnapshot,
  Claim,
  Confidence,
  ContactSignal,
  Outcome,
  OutcomeInputs,
  Reason,
  TranscriptTurn,
} from "./types.js";

const MACHINE_HINTS = ["voicemail", "machine", "ivr", "answering"];
const NO_ANSWER_HINTS = ["no_answer", "noanswer", "busy", "unreachable", "declined", "rejected", "not_answered"];

function hints(code: string | null, table: string[]): boolean {
  if (code === null) {
    return false;
  }
  const value = code.toLowerCase();
  return table.some((hint) => value.includes(hint));
}

/** CALL-E's own reading of the call, when it gave one this app understands. */
export function readStructuredSignal(value: unknown): ContactSignal | null {
  if (value === "yes") {
    return "confirmed";
  }
  if (value === "no") {
    return "denied";
  }
  if (value === "refused") {
    return "refused";
  }
  return value === "unclear" ? "unclear" : null;
}

export function outcomeFrom(inputs: OutcomeInputs, policy: { minConfidence: number }): { outcome: Outcome; reason: Reason | null } {
  if (inputs.call_status === "api_error") {
    // CALL-E refused the create, so no call was placed and nothing was asked.
    // Nothing is known about the claim, which is not the same as reaching nobody.
    return { outcome: "outcome_unknown", reason: "api_error" };
  }
  if (inputs.call_status === "state_unknown") {
    // A create or a poll that could not be settled. A call may be live.
    return { outcome: "outcome_unknown", reason: "call_state_unknown" };
  }
  if (!isTerminalCallStatus(inputs.call_status)) {
    // Still queued or in progress, so the transcript is still being written.
    return { outcome: "outcome_unknown", reason: "call_not_finished" };
  }
  if (inputs.call_status.trim().toLowerCase() !== "completed") {
    // The call is over and nobody answered the question. The status and the
    // failure code are read the same way, because a provider can put the same
    // fact in either.
    if (hints(inputs.failure_code, MACHINE_HINTS) || hints(inputs.call_status, MACHINE_HINTS)) {
      return { outcome: "unreachable", reason: "machine_answered" };
    }
    if (hints(inputs.failure_code, NO_ANSWER_HINTS) || hints(inputs.call_status, NO_ANSWER_HINTS)) {
      return { outcome: "unreachable", reason: "no_answer" };
    }
    return { outcome: "unreachable", reason: "call_failed" };
  }
  if (!inputs.completion_time_usable) {
    // The call says it completed and gives no time for it. Recorded on its own
    // rather than as a stale answer, because the window is not what failed.
    return { outcome: "outcome_unknown", reason: "completion_time_unknown" };
  }
  if (!inputs.answered_in_window) {
    // An idempotency key replayed on a later run returns the call it already has,
    // so an answer from an older window must not be read as this run's answer.
    return { outcome: "outcome_unknown", reason: "answered_outside_window" };
  }
  if (!inputs.transcript_available) {
    // A completed call with no transcript at all is a call this app could not
    // read, which is different from a call where nobody spoke.
    return { outcome: "outcome_unknown", reason: "call_not_read" };
  }
  if (inputs.machine_answered) {
    return { outcome: "unreachable", reason: "machine_answered" };
  }
  if (!inputs.reached_person) {
    return { outcome: "unreachable", reason: "nobody_spoke" };
  }
  if (!inputs.question_asked) {
    return { outcome: "unreachable", reason: "ended_before_question" };
  }
  if (inputs.signal === "unclear") {
    // Somebody was on the line and nothing they said answers the question.
    return { outcome: "outcome_unknown", reason: "no_supporting_turn" };
  }
  if (inputs.confidence !== null && inputs.confidence.score < policy.minConfidence) {
    return { outcome: "outcome_unknown", reason: "low_confidence" };
  }
  if (inputs.structured_signal !== null && inputs.structured_signal !== inputs.signal) {
    // The transcript decides and the extraction corroborates, so when the two
    // disagree this app has no answer it can stand behind.
    return { outcome: "outcome_unknown", reason: "corroboration_disagrees" };
  }
  if (inputs.signal === "refused") {
    return { outcome: "refused_to_confirm", reason: null };
  }
  return inputs.signal === "denied"
    ? { outcome: "no_such_contact", reason: null }
    : { outcome: "confirmed_genuine", reason: null };
}

/** Mask a number for anything a person or a record will read. */
export function maskPhone(phone: string): string {
  if (phone.length <= 5) {
    return "***";
  }
  return `${phone.slice(0, 3)}${"*".repeat(Math.max(phone.length - 5, 1))}${phone.slice(-2)}`;
}

export interface CallEvaluation {
  outcome: Outcome;
  reason: Reason | null;
  evidence: OutcomeInputs;
  /** What the person on the line said, verbatim. Empty when nobody answered. */
  quote: string;
  excerpt: string[];
  transcript: TranscriptTurn[];
  /** CALL-E's own note. Printed with its name on it, never treated as evidence. */
  calleeNote: string;
  callId: string | null;
  providerCallId: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

function readString(structured: Record<string, unknown> | null, key: string): string {
  const value = structured?.[key];
  return typeof value === "string" ? value.trim() : "";
}

export function evaluateCall(options: {
  claim: Claim;
  question: string;
  call: CallSnapshot | null;
  apiErrorCode?: string | null;
  /** Set when a create or a poll left a call that may be running. */
  callStateUnknown?: boolean;
  /** The call id, when it is known even though no snapshot came back. */
  callId?: string | null;
  /** False when the answer landed outside the window this run opened. */
  answeredInWindow?: boolean;
}): CallEvaluation {
  const { claim, call } = options;
  const answeredInWindow = options.answeredInWindow ?? true;

  if (call === null) {
    // Two different situations that a record has to tell apart. CALL-E refusing
    // the request means no call happened. A create or a poll that could not be
    // settled means a call may be live under the same key.
    const evidence: OutcomeInputs = {
      call_status: options.callStateUnknown === true ? "state_unknown" : "api_error",
      failure_code: options.apiErrorCode ?? null,
      transcript_available: false,
      reached_person: false,
      machine_answered: false,
      question_asked: false,
      signal: "unclear",
      structured_signal: null,
      completion_time_usable: false,
      answered_in_window: false,
      confidence: null,
    };
    const decided = outcomeFrom(evidence, claim.policy);
    return {
      outcome: decided.outcome,
      reason: decided.reason,
      evidence,
      quote: "",
      excerpt: [],
      transcript: [],
      calleeNote: "",
      callId: options.callId ?? null,
      providerCallId: null,
      startedAt: null,
      completedAt: null,
    };
  }

  const recipient = call.recipients[0] ?? null;
  const attempt = recipient?.attempts.at(-1) ?? null;
  const turns = attempt?.transcriptTurns ?? [];
  const reading = readTranscript(turns, options.question);
  const structured = call.structuredResult ?? recipient?.structuredResult ?? null;
  const confidence: Confidence | null = call.completionConfidence ?? null;
  // Read from the same field the window check reads, so a record cannot claim the
  // window was checked against a time this app could not use.
  const completionUsable = completionTime(attempt?.completedAt ?? call.completedAt) !== null;

  const evidence: OutcomeInputs = {
    call_status: call.status,
    failure_code: attempt?.failureCode ?? call.failureCode ?? null,
    transcript_available: turns.length > 0,
    reached_person: reading.calleeTurnCount > 0 && !reading.machineAnswered,
    machine_answered: reading.machineAnswered,
    question_asked: reading.questionAsked,
    signal: reading.signal,
    structured_signal: structured === null ? null : readStructuredSignal(structured.contact_confirmed),
    completion_time_usable: completionUsable,
    // A window cannot be judged against a time this app could not read, so the two
    // facts move together in a record rather than contradicting each other.
    answered_in_window: answeredInWindow && completionUsable,
    confidence,
  };
  const decided = outcomeFrom(evidence, claim.policy);

  return {
    outcome: decided.outcome,
    reason: decided.reason,
    evidence,
    // The words come from the transcript, never from the extraction. A quote
    // nobody can be shown saying is not a quote.
    quote: reading.supportingTurn,
    excerpt: reading.excerpt,
    transcript: turns,
    calleeNote: readString(structured, "notes"),
    callId: call.id,
    providerCallId: attempt?.providerCallId ?? null,
    startedAt: attempt?.startedAt ?? call.createdAt,
    completedAt: attempt?.completedAt ?? call.completedAt,
  };
}
