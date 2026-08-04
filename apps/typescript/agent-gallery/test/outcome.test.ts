import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyOutcome,
  isTerminal,
  normalizeStatus,
  outcomeFromStatus,
} from "../src/lib/outcome";

test("normalizes statuses that CALL-E reports with a space", () => {
  assert.equal(normalizeStatus("NO ANSWER"), "NO_ANSWER");
  assert.equal(normalizeStatus(" completed "), "COMPLETED");
});

test("recognizes terminal and non-terminal statuses", () => {
  assert.ok(isTerminal("COMPLETED"));
  assert.ok(isTerminal("NO ANSWER"));
  assert.ok(!isTerminal("PREPARING"));
  assert.ok(!isTerminal("SCHEDULED"));
});

test("a rejected incoming call is unreachable, not a customer decline", () => {
  assert.equal(outcomeFromStatus("DECLINED"), "unreachable");
  assert.equal(outcomeFromStatus("NO ANSWER"), "unreachable");
  assert.equal(outcomeFromStatus("VOICEMAIL"), "unreachable");
  assert.equal(outcomeFromStatus("BUSY"), "unreachable");
});

test("failure and expiry statuses stay distinct", () => {
  assert.equal(outcomeFromStatus("FAILED"), "failed");
  assert.equal(outcomeFromStatus("CANCELLED"), "failed");
  assert.equal(outcomeFromStatus("EXPIRED"), "timed_out");
});

test("a completed call defers to the conversation", () => {
  assert.equal(outcomeFromStatus("COMPLETED"), null);
});

test("an unrecognized status is uncertain rather than assumed", () => {
  assert.equal(outcomeFromStatus("SOMETHING_NEW"), "uncertain");
});

test("maps each conversational agreement to its outcome", () => {
  const base = { status: "COMPLETED" as const };
  assert.equal(classifyOutcome({ ...base, agreement: "confirmed_original" }), "confirmed");
  assert.equal(classifyOutcome({ ...base, agreement: "accepted_window" }), "rescheduled");
  assert.equal(classifyOutcome({ ...base, agreement: "refused" }), "declined");
  assert.equal(classifyOutcome({ ...base, agreement: "no_valid_window" }), "no_agreement");
});

test("an inconclusive reading of a completed call is uncertain", () => {
  assert.equal(classifyOutcome({ status: "COMPLETED", agreement: null }), "uncertain");
});

test("low completion confidence routes to human review", () => {
  const outcome = classifyOutcome({
    status: "COMPLETED",
    agreement: "accepted_window",
    calleOutcome: { task_completed: true, completion_confidence: { score: 0.3, label: "low" } },
  });
  assert.equal(outcome, "uncertain");
});

// Regression test for the Phase 2 de-risking call. CALL-E returned
// task_completed true at 0.9 confidence on a call where nothing was rebooked.
// Reading task_completed as business success would report a recovery that did
// not happen. See docs/agent-gallery/calle-api-observations.md.
test("task_completed true at high confidence is not a successful recovery", () => {
  const observed = {
    task_completed: true,
    completion_confidence: { score: 0.9, label: "high" },
  };

  assert.equal(
    classifyOutcome({
      status: "COMPLETED",
      agreement: "no_valid_window",
      calleOutcome: observed,
    }),
    "no_agreement",
  );

  assert.equal(
    classifyOutcome({ status: "COMPLETED", agreement: null, calleOutcome: observed }),
    "uncertain",
  );

  for (const agreement of [null, "no_valid_window"] as const) {
    const outcome = classifyOutcome({ status: "COMPLETED", agreement, calleOutcome: observed });
    assert.notEqual(outcome, "confirmed");
    assert.notEqual(outcome, "rescheduled");
  }
});

test("a customer who answers but rejects the offer differs from an unanswered call", () => {
  assert.notEqual(
    classifyOutcome({ status: "COMPLETED", agreement: "refused" }),
    outcomeFromStatus("DECLINED"),
  );
});
