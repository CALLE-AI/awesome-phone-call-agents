import assert from "node:assert/strict";
import test from "node:test";
import { buildRecoveryResult } from "../src/workflows/appointment-recovery/result";
import type { RecoveryRequest } from "../src/workflows/appointment-recovery/types";

function request(): RecoveryRequest {
  return {
    request_key: "key-1",
    business: {
      name: "Glow & Co. Hair Studio",
      timezone: "Asia/Singapore",
      callback_number_e164: "+6560000000",
    },
    customer: { given_name: "Mei", phone_e164: "+6580000000", consent_confirmed: true },
    appointment: {
      service: "Cut and color",
      original_time: "2026-08-03T14:00:00+08:00",
      status: "missed",
    },
    replacement_windows: [
      { start: "2026-08-07T10:00:00+08:00", end: "2026-08-07T12:00:00+08:00" },
      { start: "2026-08-08T15:00:00+08:00", end: "2026-08-08T17:00:00+08:00" },
    ],
  };
}

// Regression test. Classifying without the offered windows makes every accepted
// window unmatchable, which silently downgrades a successful rebooking to
// `uncertain`. The windows must reach the reader.
test("an accepted window is reported as a reschedule with the agreed time", () => {
  const result = buildRecoveryResult({
    request: request(),
    status: "COMPLETED",
    calle: {
      summary: "The customer accepted the Saturday window.",
      transcript: "[00:01] BOT: You're all set. I've confirmed you for Saturday 8 August at 3 PM.",
      call_id: "call-1",
      outcome: { task_completed: true, completion_confidence: { score: 0.9, label: "high" } },
    },
    runId: "run-1",
  });

  assert.equal(result.outcome, "rescheduled");
  assert.equal(result.confirmed_time, "2026-08-08T15:00:00+08:00");
  assert.equal(result.follow_up_required, false);
  assert.equal(result.call_id, "call-1");
});

test("the Phase 2 call reports no agreement and requires follow-up", () => {
  const result = buildRecoveryResult({
    request: request(),
    status: "COMPLETED",
    calle: {
      summary:
        "The call completed without a valid rebooking. The customer suggested times outside " +
        "the two approved windows, so no appointment was confirmed.",
      transcript:
        "[00:59] BOT: I can't confirm Saturday 2 PM because that isn't one of the available windows.",
      outcome: { task_completed: true, completion_confidence: { score: 0.9, label: "high" } },
    },
    runId: "run-1",
  });

  assert.equal(result.outcome, "no_agreement");
  assert.equal(result.confirmed_time, null);
  assert.equal(result.follow_up_required, true);
});

test("an unanswered call never reports an agreed time", () => {
  for (const status of ["NO ANSWER", "DECLINED", "BUSY", "VOICEMAIL"]) {
    const result = buildRecoveryResult({
      request: request(),
      status,
      calle: null,
      runId: "run-1",
    });
    assert.equal(result.outcome, "unreachable", status);
    assert.equal(result.confirmed_time, null, status);
    assert.equal(result.follow_up_required, true, status);
  }
});

test("a failed run falls back to the run id when CALL-E reported no call id", () => {
  const result = buildRecoveryResult({
    request: request(),
    status: "FAILED",
    calle: null,
    runId: "run-99",
  });
  assert.equal(result.outcome, "failed");
  assert.equal(result.call_id, "run-99");
  assert.equal(result.notes, "");
});

test("every outcome carries a next action for the operator", () => {
  const result = buildRecoveryResult({
    request: request(),
    status: "COMPLETED",
    calle: { transcript: "[00:01] BOT: Thanks, bye." },
    runId: "run-1",
  });
  assert.equal(result.outcome, "uncertain");
  assert.ok(result.next_action.length > 0);
});
