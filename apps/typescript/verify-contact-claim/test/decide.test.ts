/**
 * The five outcomes.
 *
 * `outcomeFrom` is the only place an outcome is decided. The app calls it live and
 * record verification calls it again on the stored inputs, so a record whose
 * outcome was edited by hand fails verification even when its hash chain holds.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCall, outcomeFrom } from "../src/decide.js";
import { completionTime } from "../src/evidence.js";
import type { OutcomeInputs, Policy } from "../src/types.js";
import { answered, claim, GREETING, PICK_UP, question, snapshot, turns, type SnapshotOptions } from "./fixtures.js";

const CLAIM = claim();
const QUESTION = question(CLAIM);
const POLICY: Policy = CLAIM.policy;

function evaluate(options: SnapshotOptions & { answeredInWindow?: boolean } = {}) {
  return evaluateCall({
    claim: CLAIM,
    question: QUESTION,
    call: snapshot(options),
    ...(options.answeredInWindow === undefined ? {} : { answeredInWindow: options.answeredInWindow }),
  });
}

/** Evidence for a call that answered the question cleanly. Each test bends one field. */
function inputs(overrides: Partial<OutcomeInputs> = {}): OutcomeInputs {
  return {
    call_status: "completed",
    failure_code: null,
    transcript_available: true,
    reached_person: true,
    machine_answered: false,
    question_asked: true,
    signal: "denied",
    structured_signal: null,
    completion_time_usable: true,
    answered_in_window: true,
    confidence: { score: 0.92, label: "high" },
    ...overrides,
  };
}

test("a bank that says it did contact the customer is confirmed_genuine", () => {
  const result = evaluate({
    turns: answered("Yes, that was us. We rang her about the card this morning."),
    structured: { contact_confirmed: "yes", callee_quote: "That was us.", notes: "" },
  });
  assert.equal(result.outcome, "confirmed_genuine");
  assert.equal(result.reason, null);
  assert.equal(result.quote, "Yes, that was us. We rang her about the card this morning.");
  assert.equal(result.evidence.signal, "confirmed");
  assert.equal(result.evidence.structured_signal, "confirmed");
});

test("a bank with no record of the contact is no_such_contact", () => {
  const result = evaluate({
    turns: answered("No, there is nothing on her file from us today."),
    structured: { contact_confirmed: "no", callee_quote: "Nothing on file.", notes: "" },
  });
  assert.equal(result.outcome, "no_such_contact");
  assert.equal(result.reason, null);
  assert.equal(result.quote, "No, there is nothing on her file from us today.");
});

test("a bank that will not discuss the account is refused_to_confirm, which is an answer", () => {
  const result = evaluate({
    turns: answered("I cannot discuss another customer's account, I am sorry."),
    structured: { contact_confirmed: "refused", callee_quote: "Cannot discuss.", notes: "" },
  });
  assert.equal(result.outcome, "refused_to_confirm");
  assert.equal(result.reason, null);
  assert.equal(result.evidence.signal, "refused");
});

test("a machine, an empty line or a call that ended early is unreachable", () => {
  const machine = evaluate({ turns: answered("Please leave a message after the tone.") });
  assert.equal(machine.outcome, "unreachable");
  assert.equal(machine.reason, "machine_answered");

  const silent = evaluate({ turns: turns([GREETING, QUESTION], []) });
  assert.equal(silent.outcome, "unreachable");
  assert.equal(silent.reason, "nobody_spoke");

  const early = evaluate({ turns: turns([GREETING], [PICK_UP]) });
  assert.equal(early.outcome, "unreachable");
  assert.equal(early.reason, "ended_before_question");
});

test("a failed call is unreachable and the failure code says why", () => {
  const noAnswer = evaluate({ status: "failed", failureCode: "no_answer", turns: [] });
  assert.equal(noAnswer.outcome, "unreachable");
  assert.equal(noAnswer.reason, "no_answer");

  const voicemail = evaluate({ status: "failed", failureCode: "voicemail_detected", turns: [] });
  assert.equal(voicemail.reason, "machine_answered");

  const carrier = evaluate({ status: "failed", failureCode: "carrier_error", turns: [] });
  assert.equal(carrier.reason, "call_failed");

  const canceled = evaluate({ status: "canceled", turns: [] });
  assert.equal(canceled.outcome, "unreachable");
  assert.equal(canceled.reason, "call_failed");
});

test("an answer nobody in the transcript gave is outcome_unknown", () => {
  const result = evaluate({
    turns: answered("Bear with me, the system is slow this morning."),
    // The extraction is sure. The transcript does not support it, so the app is not.
    structured: { contact_confirmed: "no", callee_quote: "They said no.", notes: "" },
  });
  assert.equal(result.outcome, "outcome_unknown");
  assert.equal(result.reason, "no_supporting_turn");
  assert.equal(result.quote, "");
});

test("a status CALL-E has not finished with never decides anything", () => {
  // The whole of CallStatus that is not terminal, plus statuses this app has never
  // seen. A no answer, a busy line or a voicemail arrives as failed with a failure
  // code, so a status spelled that way is not a status at all.
  for (const status of ["queued", "in_progress", "ringing", "dialing", "surprise", "no_answer", "busy", "voicemail"]) {
    const result = evaluate({
      status,
      turns: answered("Yes, that was us."),
      structured: { contact_confirmed: "yes", callee_quote: "us", notes: "" },
    });
    assert.equal(result.outcome, "outcome_unknown", status);
    assert.equal(result.reason, "call_not_finished", status);
  }
});

test("only the three terminal statuses are read as a finished call", () => {
  assert.equal(outcomeFrom(inputs({ call_status: "completed" }), POLICY).outcome, "no_such_contact");
  assert.equal(outcomeFrom(inputs({ call_status: "COMPLETED" }), POLICY).outcome, "no_such_contact");
  // With nothing in the transcript to stand on, how the call ended is all there is to
  // report. What a failed call that does hold an answer reports is the next test.
  assert.equal(outcomeFrom(inputs({ call_status: "failed", signal: "unclear" }), POLICY).outcome, "unreachable");
  assert.equal(outcomeFrom(inputs({ call_status: "canceled", signal: "unclear" }), POLICY).outcome, "unreachable");
});

test("a denial the call already carried is not thrown away by the status it ended on", () => {
  // A provider status says how the call ended. It is not a statement about what the
  // transcript holds. A line that drops after the person answers, an operator who hangs
  // up or a carrier error that lands late all end on failed or canceled with the answer
  // already in the call. Reporting unreachable there tells the customer nothing was
  // verified while the transcript shows their bank denying the contact.
  //
  // The old assertion in the test above said failed plus a denial is unreachable. That
  // pinned this hole, so it is gone and the case below replaces it.
  for (const status of ["failed", "canceled"]) {
    assert.equal(outcomeFrom(inputs({ call_status: status, signal: "denied" }), POLICY).outcome, "no_such_contact", status);
    assert.equal(outcomeFrom(inputs({ call_status: status, signal: "denied" }), POLICY).reason, null, status);
    assert.equal(
      outcomeFrom(inputs({ call_status: status, signal: "refused" }), POLICY).outcome,
      "refused_to_confirm",
      status,
    );
  }
  // The asymmetry, which is the point. A confirmation is the one answer that could leave
  // somebody trusting a message they should not, so it still needs a clean finish.
  const confirmed = outcomeFrom(inputs({ call_status: "failed", signal: "confirmed" }), POLICY);
  assert.equal(confirmed.outcome, "unreachable");
  assert.equal(confirmed.reason, "call_failed");
  // A failure code still names how the call ended when nothing can stand on its own.
  assert.equal(
    outcomeFrom(inputs({ call_status: "failed", failure_code: "no_answer", signal: "unclear" }), POLICY).reason,
    "no_answer",
  );
});

test("an answer read off a failed call still faces every other check", () => {
  // Falling through is what puts these in one place, so none of them are relaxed for a
  // call that ended badly. A stale replay is the one this matters most for: without the
  // window an old denial could answer a fresh run.
  const base = { call_status: "failed", signal: "denied" as const };
  assert.equal(
    outcomeFrom(inputs({ ...base, completion_time_usable: false, answered_in_window: false }), POLICY).reason,
    "completion_time_unknown",
  );
  assert.equal(outcomeFrom(inputs({ ...base, answered_in_window: false }), POLICY).reason, "answered_outside_window");
  assert.equal(outcomeFrom(inputs({ ...base, transcript_available: false }), POLICY).reason, "call_not_read");
  assert.equal(outcomeFrom(inputs({ ...base, question_asked: false }), POLICY).reason, "ended_before_question");
  assert.equal(outcomeFrom(inputs({ ...base, structured_signal: "confirmed" }), POLICY).reason, "corroboration_disagrees");
  assert.equal(
    outcomeFrom(inputs({ ...base, confidence: { score: 0.1, label: "low" } }), POLICY).reason,
    "low_confidence",
  );
});

test("a completed call with no transcript at all is unreadable, not an empty line", () => {
  const result = evaluate({
    turns: [],
    structured: { contact_confirmed: "no", callee_quote: "", notes: "" },
  });
  assert.equal(result.outcome, "outcome_unknown");
  assert.equal(result.reason, "call_not_read");
  assert.equal(result.evidence.transcript_available, false);
});

test("a completion time this app cannot use fails closed with its own reason", () => {
  // A replayed call that finished in an older window is indistinguishable from a
  // fresh one without the provider's own clock, so a missing one refuses.
  for (const completedAt of [null, "", "   ", "not a date", 42, {}, true]) {
    const result = evaluate({
      completedAt,
      turns: answered("No, nothing from us."),
    });
    assert.equal(result.outcome, "outcome_unknown", String(completedAt));
    assert.equal(result.reason, "completion_time_unknown", String(completedAt));
    assert.equal(result.evidence.completion_time_usable, false);
    assert.equal(result.evidence.answered_in_window, false);
  }
  assert.equal(completionTime("2026-07-31T16:20:00Z"), Date.parse("2026-07-31T16:20:00Z"));
  assert.equal(completionTime(undefined), null);
});

test("an answer from outside this run's window does not become this run's answer", () => {
  const result = evaluate({ turns: answered("Yes, that was us."), answeredInWindow: false });
  assert.equal(result.outcome, "outcome_unknown");
  assert.equal(result.reason, "answered_outside_window");
});

test("CALL-E disagreeing with the transcript refuses to answer either way", () => {
  const result = evaluate({
    turns: answered("No, nothing from us at all."),
    structured: { contact_confirmed: "yes", callee_quote: "It was us.", notes: "" },
  });
  assert.equal(result.outcome, "outcome_unknown");
  assert.equal(result.reason, "corroboration_disagrees");
  assert.equal(result.evidence.signal, "denied");
  assert.equal(result.evidence.structured_signal, "confirmed");
});

test("a null structured result corroborates nothing and blocks nothing", () => {
  // CALL-E returns null on calls that went perfectly, so needing it would fail for
  // the wrong reason and trusting it alone would answer off a summary.
  const result = evaluate({ turns: answered("No, nothing from us at all."), structured: null });
  assert.equal(result.outcome, "no_such_contact");
  assert.equal(result.evidence.structured_signal, null);
});

test("a structured result that reads unclear is still a disagreement", () => {
  const result = evaluate({
    turns: answered("Yes, we called her this morning."),
    structured: { contact_confirmed: "unclear", callee_quote: "", notes: "" },
  });
  assert.equal(result.outcome, "outcome_unknown");
  assert.equal(result.reason, "corroboration_disagrees");
});

test("a structured result with a value this app does not know corroborates nothing", () => {
  const result = evaluate({
    turns: answered("Yes, we called her this morning."),
    structured: { contact_confirmed: "probably", callee_quote: "", notes: "" },
  });
  assert.equal(result.evidence.structured_signal, null);
  assert.equal(result.outcome, "confirmed_genuine");
});

test("a call CALL-E scored low on itself does not get to answer", () => {
  const result = evaluate({
    turns: answered("Yes, that was us."),
    confidence: { score: 0.2, label: "low" },
  });
  assert.equal(result.outcome, "outcome_unknown");
  assert.equal(result.reason, "low_confidence");
});

test("a refused create is not a call, so nothing about the claim is known", () => {
  const result = evaluateCall({
    claim: CLAIM,
    question: QUESTION,
    call: null,
    apiErrorCode: "insufficient_balance",
  });
  assert.equal(result.outcome, "outcome_unknown");
  assert.equal(result.reason, "api_error");
  assert.equal(result.evidence.call_status, "api_error");
  assert.equal(result.evidence.failure_code, "insufficient_balance");
  assert.equal(result.callId, null);
});

test("a call that may be live is recorded as unknown with its id kept", () => {
  const result = evaluateCall({
    claim: CLAIM,
    question: QUESTION,
    call: null,
    apiErrorCode: "service_unavailable",
    callStateUnknown: true,
    callId: "call_maybe",
  });
  assert.equal(result.outcome, "outcome_unknown");
  assert.equal(result.reason, "call_state_unknown");
  assert.equal(result.evidence.call_status, "state_unknown");
  assert.equal(result.callId, "call_maybe");
});

test("the inputs alone decide the outcome, which is what verification replays", () => {
  assert.equal(outcomeFrom(inputs({ signal: "confirmed" }), POLICY).outcome, "confirmed_genuine");
  assert.equal(outcomeFrom(inputs({ signal: "denied" }), POLICY).outcome, "no_such_contact");
  assert.equal(outcomeFrom(inputs({ signal: "refused" }), POLICY).outcome, "refused_to_confirm");
  assert.equal(outcomeFrom(inputs({ signal: "unclear" }), POLICY).reason, "no_supporting_turn");
  assert.equal(outcomeFrom(inputs({ machine_answered: true }), POLICY).reason, "machine_answered");
  assert.equal(outcomeFrom(inputs({ reached_person: false }), POLICY).reason, "nobody_spoke");
  assert.equal(outcomeFrom(inputs({ question_asked: false }), POLICY).reason, "ended_before_question");
  assert.equal(outcomeFrom(inputs({ transcript_available: false }), POLICY).reason, "call_not_read");
  assert.equal(outcomeFrom(inputs({ completion_time_usable: false, answered_in_window: false }), POLICY).reason, "completion_time_unknown");
  assert.equal(outcomeFrom(inputs({ answered_in_window: false }), POLICY).reason, "answered_outside_window");
  assert.equal(outcomeFrom(inputs({ call_status: "state_unknown" }), POLICY).reason, "call_state_unknown");
  assert.equal(outcomeFrom(inputs({ call_status: "api_error" }), POLICY).reason, "api_error");
  assert.equal(outcomeFrom(inputs({ structured_signal: "refused" }), POLICY).reason, "corroboration_disagrees");
  assert.equal(outcomeFrom(inputs({ confidence: { score: 0.1, label: "low" } }), POLICY).reason, "low_confidence");
  assert.equal(outcomeFrom(inputs({ confidence: null }), POLICY).outcome, "no_such_contact");
});

test("the five outcomes are the whole range this app can return", () => {
  const seen = new Set<string>();
  for (const patch of [
    { signal: "confirmed" as const },
    { signal: "denied" as const },
    { signal: "refused" as const },
    { machine_answered: true },
    { call_status: "state_unknown" },
  ]) {
    seen.add(outcomeFrom(inputs(patch), POLICY).outcome);
  }
  assert.deepEqual(
    [...seen].sort(),
    ["confirmed_genuine", "no_such_contact", "outcome_unknown", "refused_to_confirm", "unreachable"],
  );
});
