/**
 * The errand run against a stub port instead of the fake server.
 *
 * The fake server only ever writes snapshots a well behaved CALL-E would write, so
 * it cannot reach the cases that matter here: a call CALL-E has not finished with,
 * an extraction that claims an agreement about a time nobody said, an answer to a
 * question the caller never asked. Each of those is one hand written snapshot.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { CalleWaitTimeout, type CallePort } from "../src/calle.js";
import { runErrand } from "../src/errand.js";
import type { CallSnapshot, TranscriptTurn } from "../src/types.js";
import { BOT_LINES, CLINIC, errandRequest, goodResult, USER_LINES } from "./fixtures.js";

/** The fixture conversation, interleaved the way a real transcript comes back. */
function conversation(bot: string[] = BOT_LINES, user: string[] = USER_LINES): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  let offset = 0;
  for (let index = 0; index < Math.max(bot.length, user.length); index += 1) {
    for (const [speaker, text] of [["bot", bot[index]], ["user", user[index]]] as const) {
      if (text !== undefined) {
        turns.push({ offset_seconds: offset, speaker, text });
        offset += 6;
      }
    }
  }
  return turns;
}

function snapshot(
  status: string,
  turns: TranscriptTurn[],
  structured: Record<string, unknown> | null,
): CallSnapshot {
  const attempt = {
    id: "att_stub1",
    phone: CLINIC,
    status,
    startedAt: "2026-08-04T17:02:00Z",
    completedAt: null,
    summary: null,
    transcriptTurns: turns,
    providerCallId: "provider_stub1",
    failureCode: null,
    failureMessage: null,
  };
  return {
    id: "call_stub1",
    status,
    recipients: [
      {
        id: "rcp_stub1",
        phones: [CLINIC],
        status,
        structuredResult: structured,
        summary: null,
        attempts: [attempt],
      },
    ],
    structuredResult: structured,
    summary: null,
    taskCompleted: null,
    completionConfidence: { score: 0.94, label: "high" },
    evidence: [],
    failureCode: null,
    failureMessage: null,
    createdAt: "2026-08-04T17:01:50Z",
    completedAt: null,
  };
}

/** One snapshot, handed back however the app asks for it. */
function stubPort(read: CallSnapshot, waitTimesOut = false): CallePort {
  return {
    createCall: async () => snapshot("queued", [], null),
    waitForResult: async () => {
      if (waitTimesOut) {
        throw new CalleWaitTimeout("Timed out waiting for CALL-E call call_stub1.");
      }
      return read;
    },
    getCall: async () => read,
  };
}

function run(read: CallSnapshot, waitTimesOut = false) {
  return runErrand({ request: errandRequest(), port: stubPort(read, waitTimesOut), pollIntervalMs: 5 });
}

test("a call CALL-E has not finished with is no result, whatever the extraction claims", async () => {
  // The read back after the timeout says in_progress and carries a full transcript
  // and a confident extraction. None of that makes it a finished call.
  const report = await run(snapshot("in_progress", conversation(), goodResult()), true);
  assert.equal(report.outcome, "outcome_unknown");
  assert.equal(report.call_status, "unknown");
  assert.equal(report.call_id, "call_stub1");
  assert.equal(report.commitment, "unconfirmed");
  assert.equal(report.committed_datetime, null);
  assert.equal(report.confirmation_code, "");
  assert.equal(report.answers.every((answer) => !answer.answered), true);
  assert.deepEqual(report.disclosed, []);
  assert.deepEqual(report.leaks, []);
  assert.equal(report.reached_person, false);
  assert.match(report.callee_notes, /in_progress/);
  assert.match(report.next_step, /not known yet/);
  assert.equal(report.provider_call_id, "provider_stub1");
});

test("no state short of finished is evaluated, whichever one it is", async () => {
  for (const status of ["queued", "in_progress", "ringing", "scheduled", "dialing", "unknown", ""]) {
    const report = await run(snapshot(status, conversation(), goodResult()), true);
    assert.equal(report.outcome, "outcome_unknown", `status ${status}`);
    assert.equal(report.call_status, "unknown", `status ${status}`);
    assert.equal(report.call_id, "call_stub1", `status ${status}`);
  }
});

test("a finished call is still read, so nothing stopped being reported", async () => {
  const report = await run(snapshot("completed", conversation(), goodResult()));
  assert.equal(report.outcome, "goal_met");
  assert.equal(report.commitment, "committed");
  assert.equal(report.committed_datetime, "2026-08-13T09:40:00-07:00");
  assert.equal(report.call_status, "completed");
  assert.equal(report.answers.every((answer) => answer.answered), true);
});

test("an answer to a question nobody asked is not an answer", async () => {
  // The caller never reached the third question. The callee mentioned it anyway and
  // the extraction reported that sentence as the answer.
  const user = [
    ...USER_LINES.slice(0, 3),
    "Yes, we take Blue Shield PPO. Photo identification and the insurance card are what new patients bring.",
  ];
  const report = await run(snapshot("completed", conversation(BOT_LINES.slice(0, 4), user), goodResult()));
  const bring = report.answers.find((answer) => answer.id === "bring")!;
  assert.equal(bring.answered, false);
  assert.equal(bring.answer, "");
  assert.equal(bring.quote, "");
  assert.match(report.callee_notes, /1 answer\(s\) the transcript does not support/);
});

test("an agreement about another time is not the agreement the extraction claims", async () => {
  // Ray's case: booking language in the call, plus a different time from the
  // extraction that happens to fall inside an authorized window.
  const user = [
    "Bayview Family Clinic, how can I help?",
    "Let me look. Can I take the date of birth?",
    "Nothing on Thursday, I am afraid. I have booked her in for Tuesday the eighteenth at half past three.",
    "Yes, we take Blue Shield PPO.",
    "Photo identification and the insurance card.",
  ];
  const report = await run(
    snapshot("completed", conversation(BOT_LINES, user), goodResult("2026-08-12T14:00:00-07:00")),
  );
  assert.equal(report.commitment, "unconfirmed");
  assert.equal(report.committed_datetime, null);
  assert.equal(report.confirmation_code, "");
  assert.notEqual(report.outcome, "goal_met");
  assert.match(report.callee_notes, /no turn in the transcript agrees to that/);
  // What they did agree to is quoted, so the person is not told nothing happened.
  assert.match(report.callee_notes, /I have booked her in for Tuesday/);
  assert.match(report.next_step, /treat nothing as booked/);
});

test("a confirmation code nobody read out is not in the report", async () => {
  const user = [...USER_LINES];
  user[2] = "Earliest is Thursday the thirteenth at nine forty in the morning. I can hold that slot.";
  const report = await run(snapshot("completed", conversation(BOT_LINES, user), goodResult()));
  assert.equal(report.commitment, "committed");
  assert.equal(report.confirmation_code, "");
  assert.match(report.callee_notes, /nobody read one out around the agreement/);
});

test("an agreement to the same time on another day is not this agreement", async () => {
  // Both days are authorized, so the window check cannot catch this one. The
  // transcript says Thursday the thirteenth and the extraction says the twelfth.
  const report = await run(snapshot("completed", conversation(), goodResult("2026-08-12T09:40:00-07:00")));
  assert.equal(report.commitment, "unconfirmed");
  assert.equal(report.committed_datetime, null);
  assert.equal(report.confirmation_code, "");
  assert.match(report.callee_notes, /Wednesday, August 12 at 9:40 AM/);
});

test("an agreement with no time has nothing to check against the windows", async () => {
  const report = await run(snapshot("completed", conversation(), { ...goodResult(), offered_datetime: "" }));
  assert.equal(report.commitment, "unconfirmed");
  assert.equal(report.committed_datetime, null);
  assert.equal(report.confirmation_code, "");
  assert.match(report.callee_notes, /no time for it/);
  assert.equal(report.next_step.includes("outside the windows"), false);
});

test("the model's own note is labelled as the model's", async () => {
  const report = await run(
    snapshot("completed", conversation(), { ...goodResult(), notes: "the receptionist sounded rushed" }),
  );
  assert.match(report.callee_notes, /CALL-E's note, unchecked: "the receptionist sounded rushed"/);
});

test("a call that ended without a conversation is read from its own status", async () => {
  const cases: [string, string][] = [
    ["no_answer", "not_reached"],
    ["busy", "not_reached"],
    ["voicemail", "voicemail"],
    ["failed", "call_failed"],
    ["canceled", "call_failed"],
  ];
  for (const [status, outcome] of cases) {
    const report = await run(snapshot(status, [], null));
    assert.equal(report.outcome, outcome, `status ${status}`);
    assert.equal(report.call_status, status, `status ${status}`);
  }
});
