import { test } from "node:test";
import assert from "node:assert/strict";
import { callFailure, callProgress } from "../lib/call-status";
import type { CallRecord } from "../lib/types";

const call: CallRecord = {
  callId: "call_test",
  status: "in_progress",
  attemptStatus: "in_progress",
  transcript: [],
  summary: null,
  taskCompleted: null,
  completionConfidence: null,
  taskEvidence: [],
  structuredResult: null,
  failureCode: null,
  failureMessage: null,
  createdAt: "2026-09-05T20:19:34Z",
  completedAt: null,
};
const greeting = { offsetSeconds: 0, speaker: "bot" as const, text: "Is now a good time?" };
const response = { offsetSeconds: 2, speaker: "user" as const, text: "Yes." };

test("pending, dialing, and in-progress execution do not prove a connection", () => {
  assert.equal(callProgress(null).phase, "connecting");
  for (const attemptStatus of [null, "queued", "dialing", "in_progress"] as const) {
    assert.equal(callProgress({ ...call, attemptStatus }).phase, "connecting");
  }
});

test("caller speech alone does not establish that the recipient answered", () => {
  assert.equal(callProgress({ ...call, transcript: [greeting] }).phase, "waiting");
  assert.equal(callProgress({ ...call, transcript: [{ ...response, text: "  " }] }).phase, "connecting");
  assert.equal(callProgress({ ...call, transcript: [{ ...response, speaker: "unknown" }] }).phase, "connecting");
  assert.equal(callProgress({ ...call, transcript: [greeting, response] }).phase, "conversation");
});

test("an ended attempt is finalizing even if the task is in progress and has a transcript", () => {
  for (const attemptStatus of ["completed", "failed", "canceled"] as const) {
    assert.equal(callProgress({ ...call, attemptStatus, transcript: [greeting, response] }).phase, "finalizing");
    assert.equal(callProgress({ ...call, attemptStatus }).phase, "finalizing");
  }
});

test("the declined call sequence never claims a conversation or blames the recipient", () => {
  const failed = {
    ...call,
    status: "failed" as const,
    attemptStatus: "failed" as const,
    failureCode: "call_failed",
    failureMessage: "calling task status=DECLINED (Hangup by: user)",
  };
  assert.equal(callProgress(call).label, "Connecting…");
  assert.equal(callProgress({ ...failed, status: "in_progress" }).phase, "finalizing");
  const failure = callFailure(failed);
  assert.equal(failure.title, "Call could not connect");
  assert.match(failure.message, /No conversation was recorded/);
  assert.doesNotMatch(failure.message, /DECLINED|Hangup|603|candidate declined/i);
});

test("a declined call is diagnosed as a screened number, not as a candidate who refused", () => {
  // The exact record CALL-E returned for call_CsVdVmnQCHRRc4I7v845ag.
  const declined = {
    ...call,
    status: "failed" as const,
    attemptStatus: "failed" as const,
    failureCode: "603",
    failureMessage: "calling task status=DECLINED (Hangup by: user)",
  };
  const { diagnosis } = callFailure(declined);
  assert.ok(diagnosis, "a failed call must say why");
  assert.match(diagnosis.reason, /rejected the call before it rang/);
  assert.match(diagnosis.hint, /spam filter|Do Not Disturb|silence unknown/i);
  // The whole point: the operator is told this is not evidence about the person.
  assert.match(diagnosis.hint, /not a signal about the candidate/i);
  // Never asserts the candidate did it, in any rendered field.
  for (const text of [diagnosis.reason, diagnosis.hint]) {
    assert.doesNotMatch(text, /hung up|refused|declined your call|they rejected/i);
  }
  // The raw provider text stays available, but only as data.
  assert.equal(diagnosis.code, "603");
  assert.match(diagnosis.raw ?? "", /Hangup by: user/);
});

test("each carrier outcome an operator can act on is distinguished", () => {
  const failed = { ...call, status: "failed" as const, attemptStatus: "failed" as const };
  const reason = (failureCode: string | null, failureMessage: string | null = null) =>
    callFailure({ ...failed, failureCode, failureMessage }).diagnosis?.reason ?? "";

  assert.match(reason("486"), /busy/i);
  assert.match(reason("408"), /rang out/i);
  assert.match(reason(null, "NO_ANSWER"), /rang out/i);
  assert.match(reason("404"), /could not route/i);
  assert.match(reason(null, "invalid number"), /could not route/i);
  assert.match(reason(null, "reached voicemail"), /voicemail/i);
  // An unrecognised code still produces something honest rather than nothing.
  assert.match(reason("799"), /no reason Clarity recognises/i);
  // A call with no failure fields at all is not diagnosed.
  assert.equal(callFailure({ ...failed, failureCode: null, failureMessage: null }).diagnosis, null);
});

test("failure after recorded speech preserves the distinction from a call that never connected", () => {
  const failure = callFailure({ ...call, status: "failed", transcript: [greeting, response] });
  assert.equal(failure.title, "Phone screen incomplete");
  assert.match(failure.message, /recorded conversation/);
  assert.doesNotMatch(failure.message, /Nothing was clarified|No conversation/);
});

test("canceled calls are not described as connection failures", () => {
  assert.equal(callFailure({ ...call, status: "canceled" }).title, "Call canceled");
});
