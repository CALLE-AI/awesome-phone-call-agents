import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  detectSurface,
  fromWebhookEvent,
  normalize,
  unsigned,
  UNSIGNED_REASON,
  UnknownSurfaceError,
} from "asheard/disposition";
import { normalizeCallsApi } from "asheard/disposition";
import { canonicalMcpStatus } from "asheard/disposition";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(here, "..", "fixtures");

function fixture(relative: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(fixturesRoot, relative), "utf8"));
}

test("a completed Calls API call cannot say whether a person answered", () => {
  const d = normalize(fixture("calls-api/completed-no-answered-by.json"));
  assert.equal(d.surface, "calls-api");
  assert.equal(d.endstate.value, "answered_unspecified");
  assert.equal(d.endstate.basis, "absent");
  assert.equal(d.taskOutcome.value, "met");
  assert.equal(d.resultState.value, "valid");
  assert.equal(d.needsHuman, true, "an unspecified answerer must route to a person");
});

test("an app-declared answered_by field is read and credited", () => {
  const d = normalize(fixture("calls-api/completed-answered-by-voicemail.json"));
  assert.equal(d.endstate.value, "answered_machine");
  assert.equal(d.endstate.basis, "quoted");
  assert.match(d.endstate.from[0] ?? "", /answered_by$/);
  assert.equal(d.taskOutcome.value, "not_met");
});

test("a failed Calls API call resolves to unknown, never to a guessed cause", () => {
  const d = normalize(fixture("calls-api/failed-opaque.json"));
  assert.equal(d.endstate.value, "unknown");
  assert.equal(d.endstate.basis, "absent");
  assert.match(d.endstate.note, /no published enum/);
  assert.equal(d.needsHuman, true);
});

test("task_completed says true for a voicemail box, and the reading survives it", () => {
  const d = normalize(fixture("calls-api/completed-voicemail-task-completed.json"));

  // Read faithfully. The payload does say the task was met, and lying about
  // that would be its own bug.
  assert.equal(d.taskOutcome.value, "met");
  assert.equal(d.taskOutcome.basis, "quoted");

  // And the surface still cannot say who or what answered.
  assert.equal(d.endstate.value, "answered_unspecified");
  assert.equal(d.endstate.basis, "absent");

  assert.equal(d.needsHuman, true);
  assert.ok(
    d.reasons.some((reason) => /never established that a person|was ever on the line/.test(reason)),
    "the dangerous pairing has to name itself in the reasons",
  );
});

test("a completed task on a stated human ending is not flagged for the pairing", () => {
  const d = normalizeCallsApi({
    status: "completed",
    task_completed: true,
    structured_result: { answered_by: "human", open_saturday: "yes" },
    result_schema_requested: true,
  });
  assert.equal(d.endstate.value, "answered_human");
  assert.equal(d.taskOutcome.value, "met");
  assert.ok(
    !d.reasons.some((reason) => /was ever on the line/.test(reason)),
    "the rule fires on the endstate, not on every met task",
  );
});

test("the Calls API can say no_answer, just never in failure_code", () => {
  const d = normalize(fixture("calls-api/failed-no-answer-nested.json"));
  assert.equal(d.endstate.value, "no_answer");
  assert.equal(d.endstate.basis, "derived", "read off a nested code, so never quoted");
  assert.match(d.endstate.from[0] ?? "", /attempts\[0\]\.failure_code$/);
  assert.equal(d.needsHuman, true, "a derived endstate is never auto-closed");
});

test("failure_message says NO ANSWER for a busy line, so it is not read as an ending", () => {
  const noAnswer = normalize(fixture("calls-api/failed-no-answer-nested.json"));
  const busy = normalize(fixture("calls-api/failed-busy-attempt-486.json"));

  // The same sentence on both payloads, and they end differently. If the
  // message were readable as an ending, these two would have to agree.
  assert.equal(
    (fixture("calls-api/failed-no-answer-nested.json") as { failure_message: string })
      .failure_message,
    (fixture("calls-api/failed-busy-attempt-486.json") as { failure_message: string })
      .failure_message,
  );
  assert.notEqual(noAnswer.endstate.value, busy.endstate.value);
  assert.equal(busy.endstate.value, "busy");
  assert.match(busy.endstate.from[0] ?? "", /attempts\[0\]\.failure_code$/);
});

test("an attempt code nobody has watched happen is not turned into an ending", () => {
  const payload = fixture("calls-api/failed-busy-attempt-486.json");
  (payload.recipients as Array<{ attempts: Array<{ failure_code: string }> }>)[0]!
    .attempts[0]!.failure_code = "603";
  const d = normalize(payload);
  assert.equal(d.endstate.value, "unknown");
  assert.equal(d.endstate.basis, "absent");
  assert.match(d.endstate.note, /never been watched happen/);
});

test("a failed call with no attempt code refuses to read the message", () => {
  const payload = fixture("calls-api/failed-busy-attempt-486.json");
  (payload.recipients as Array<{ attempts: Array<{ failure_code: string | null }> }>)[0]!
    .attempts[0]!.failure_code = null;
  const d = normalize(payload);
  assert.equal(d.endstate.value, "unknown");
  assert.equal(d.endstate.basis, "absent");
  assert.match(d.endstate.note, /observed saying NO ANSWER for a busy line/);
});

test("a result from a call that never connected is not a valid result", () => {
  const d = normalize(fixture("calls-api/failed-with-synthesized-result.json"));
  assert.equal(d.resultState.value, "unsourced");
  assert.equal(d.resultState.basis, "derived");
  assert.equal(d.endstate.value, "unknown");
  assert.equal(d.taskOutcome.value, "not_met");
  assert.equal(d.needsHuman, true);
  assert.ok(
    d.reasons.some((reason) => /never reached a conversation/.test(reason)),
    "the review reason must say the result had no conversation behind it",
  );
});

test("high completion_confidence is not evidence the task was done", () => {
  const d = normalize(fixture("calls-api/failed-with-synthesized-result.json"));
  // Confidence is the platform's confidence in its own judgment, and on a
  // payload like this the judgment it is confident about is "not completed".
  assert.equal(d.taskOutcome.value, "not_met");
  assert.equal(d.taskOutcome.basis, "quoted");
  assert.deepEqual(d.taskOutcome.from, ["task_completed"]);
});

test("a webhook validation failure is a result problem, not a call problem", () => {
  const d = fromWebhookEvent(
    fixture("calls-api/webhook-result-validation-failed.json") as {
      id: string;
      type: string;
      data: Record<string, unknown>;
    },
  );
  assert.equal(d.resultState.value, "schema_invalid");
  assert.equal(d.taskOutcome.value, "met");
  assert.equal(d.needsHuman, true);
});

test("Goal Runs states no_answer outright where the Calls API cannot", () => {
  const d = normalize(fixture("goal-runs/no-answer.json"));
  assert.equal(d.surface, "goal-runs");
  assert.equal(d.endstate.value, "no_answer");
  assert.equal(d.endstate.basis, "quoted");
  assert.equal(d.taskOutcome.value, "not_met");
});

test("Goal Runs states declined outright", () => {
  const d = normalize(fixture("goal-runs/declined.json"));
  assert.equal(d.endstate.value, "declined");
  assert.equal(d.endstate.basis, "quoted");
});

test("a Goal Run result implies a conversation, and the inference is marked derived", () => {
  const d = normalize(fixture("goal-runs/result-ok.json"));
  assert.equal(d.endstate.value, "answered_human");
  assert.equal(d.endstate.basis, "derived");
  assert.equal(d.resultState.value, "valid");
  assert.equal(d.needsHuman, true, "a derived endstate is never auto-closed");
});

test("a timeout describes the wait, not the call", () => {
  const d = normalize(fixture("goal-runs/timed-out.json"));
  assert.equal(d.endstate.value, "unknown");
  assert.match(d.endstate.note, /does not cancel the call/);
});

test("a Goal Run with null result and null error is not finished, whatever status says", () => {
  const payload = fixture("goal-runs/still-parsing.json");
  assert.equal(payload.status, "completed");
  const d = normalize(payload);
  assert.equal(d.endstate.value, "unknown");
  assert.match(d.endstate.note, /not finished yet/);
});

test("MCP says voicemail, which no other surface can express", () => {
  const d = normalize(fixture("mcp/voicemail.json"));
  assert.equal(d.surface, "mcp");
  assert.equal(d.endstate.value, "answered_machine");
  assert.equal(d.endstate.basis, "quoted");
});

test("MCP says busy, which no other surface can express", () => {
  const d = normalize(fixture("mcp/busy.json"));
  assert.equal(d.endstate.value, "busy");
  assert.equal(d.endstate.basis, "quoted");
});

test("both cancel spellings land on one value", () => {
  const doubleL = normalize(fixture("mcp/cancelled-double-l.json"));
  assert.equal(doubleL.endstate.value, "canceled");
  assert.equal(canonicalMcpStatus("CANCELED"), "CANCELED");
  assert.equal(canonicalMcpStatus("CANCELLED"), "CANCELLED");
});

test("NO ANSWER with a space is the same terminal state as NO_ANSWER", () => {
  const d = normalize(fixture("mcp/no-answer-spaced.json"));
  assert.equal(d.endstate.value, "no_answer");
  assert.equal(d.endstate.basis, "quoted");
});

test("MCP COMPLETED is not read as the task being done", () => {
  const d = normalize(fixture("mcp/completed.json"));
  assert.equal(d.endstate.value, "answered_human");
  assert.equal(d.taskOutcome.value, "unverified");
  assert.equal(d.needsHuman, true);
});

test("a non-terminal MCP status is never read as an ending", () => {
  const d = normalize(fixture("mcp/preparing.json"));
  assert.equal(d.endstate.value, "unknown");
  assert.match(d.endstate.note, /still going/);
});

test("MCP never reports a structured result, because it cannot ask for one", () => {
  for (const name of ["voicemail", "busy", "completed", "failed", "expired"]) {
    const d = normalize(fixture(`mcp/${name}.json`));
    assert.equal(d.resultState.value, "not_requested", `${name} should not claim a result`);
  }
});

test("surface detection refuses an ambiguous payload instead of guessing", () => {
  assert.equal(detectSurface({ hello: "world" }), null);
  assert.throws(() => normalize({ hello: "world" } as never), UnknownSurfaceError);
});

test("surface detection separates the three shapes", () => {
  assert.equal(detectSurface(fixture("calls-api/failed-opaque.json")), "calls-api");
  assert.equal(detectSurface(fixture("goal-runs/no-answer.json")), "goal-runs");
  assert.equal(detectSurface(fixture("mcp/busy.json")), "mcp");
});

test("every fixture produces a reading with named source fields", () => {
  const all = [
    "calls-api/completed-no-answered-by.json",
    "calls-api/completed-answered-by-voicemail.json",
    "calls-api/failed-opaque.json",
    "goal-runs/no-answer.json",
    "goal-runs/declined.json",
    "goal-runs/result-ok.json",
    "goal-runs/timed-out.json",
    "goal-runs/still-parsing.json",
    "mcp/voicemail.json",
    "mcp/busy.json",
    "mcp/declined.json",
    "mcp/failed.json",
    "mcp/expired.json",
    "mcp/completed.json",
    "mcp/no-answer-spaced.json",
    "mcp/cancelled-double-l.json",
    "mcp/preparing.json",
  ];
  for (const name of all) {
    const d = normalize(fixture(name));
    for (const axis of [d.endstate, d.taskOutcome, d.resultState]) {
      assert.ok(axis.note.length > 0, `${name} has an axis with no explanation`);
      assert.ok(
        axis.basis !== "absent" || axis.from.length >= 0,
        `${name} has a reading with no provenance`,
      );
    }
  }
});

test("needsHuman is set whenever any axis is unknown", () => {
  for (const name of ["calls-api/failed-opaque.json", "goal-runs/timed-out.json", "mcp/preparing.json"]) {
    const d = normalize(fixture(name));
    assert.equal(d.needsHuman, true, `${name} must route to a person`);
    assert.ok(d.reasons.length > 0, `${name} must say why`);
  }
});

test("an unsigned arrival says so, and says it first", () => {
  const read = normalize(fixture("calls-api/completed-no-answered-by.json"));
  const arrived = unsigned(read);

  assert.equal(arrived.reasons[0], UNSIGNED_REASON);
  assert.equal(arrived.needsHuman, true);
  assert.deepEqual(
    arrived.reasons.slice(1),
    read.reasons,
    "marking the channel must not disturb what the payload said",
  );
});

test("marking a reading unsigned twice does not say it twice", () => {
  const once = unsigned(normalize(fixture("calls-api/completed-no-answered-by.json")));
  const twice = unsigned(once);
  assert.deepEqual(twice.reasons, once.reasons);
});

test("an unsigned arrival forces review even when everything agreed", () => {
  const clean = normalizeCallsApi({
    status: "completed",
    task_completed: true,
    structured_result: { answered_by: "human", open_saturday: "yes" },
    result_schema_requested: true,
  });
  assert.equal(clean.needsHuman, false, "the payload on its own is clean");

  const arrived = unsigned(clean);
  assert.equal(arrived.needsHuman, true, "the channel alone is enough to want a person");
  assert.equal(arrived.reasons.length, 1);
});

test("the three axes are untouched by how the payload arrived", () => {
  const read = normalize(fixture("calls-api/failed-busy-attempt-486.json"));
  const arrived = unsigned(read);
  assert.deepEqual(arrived.endstate, read.endstate);
  assert.deepEqual(arrived.taskOutcome, read.taskOutcome);
  assert.deepEqual(arrived.resultState, read.resultState);
});

test("a completed call where nobody spoke did not source its own result", () => {
  const d = normalize(fixture("calls-api/completed-no-user-turns.json"));

  // Nothing about the status looks wrong. That is the point.
  assert.equal(d.endstate.value, "answered_unspecified");
  assert.equal(d.taskOutcome.value, "not_met");

  assert.equal(d.resultState.value, "unsourced");
  assert.equal(d.resultState.basis, "derived");
  assert.match(d.resultState.from[0] ?? "", /transcript_turns$/);
  assert.equal(d.needsHuman, true);
});

test("one user turn is enough to stop calling a result unsourced", () => {
  const payload = fixture("calls-api/completed-no-user-turns.json");
  const attempt = (payload.recipients as Array<{ attempts: Array<{ transcript_turns: unknown[] }> }>)[0]!
    .attempts[0]!;
  attempt.transcript_turns = [
    ...attempt.transcript_turns,
    { offset_seconds: 12, speaker: "user", text: "Yes, we are open on Saturday." },
  ];
  const d = normalize(payload);
  assert.equal(d.resultState.value, "valid");
});

test("a payload with no transcript at all is not accused of anything", () => {
  // Absence of a transcript says nothing either way, and guessing from it
  // would be the mistake this whole library is a complaint about.
  const d = normalize(fixture("calls-api/completed-no-answered-by.json"));
  assert.equal(d.resultState.value, "valid");
});

test("an unassigned number comes back unreachable, off the attempt code", () => {
  const d = normalize(fixture("calls-api/failed-unreachable-403.json"));
  assert.equal(d.endstate.value, "unreachable");
  assert.equal(d.endstate.basis, "derived");
  assert.match(d.endstate.from[0] ?? "", /attempts\[0\]\.failure_code$/);
  assert.equal(d.needsHuman, true);
});

test("failure_message carries a third value, so it is still not an ending", () => {
  const unreachable = fixture("calls-api/failed-unreachable-403.json") as { failure_message: string };
  const noAnswer = fixture("calls-api/failed-no-answer-nested.json") as { failure_message: string };
  assert.notEqual(unreachable.failure_message, noAnswer.failure_message);
  assert.match(unreachable.failure_message, /FAILED/);

  // Three observed values across three different endings, and the field is
  // read for none of them.
  const payload = fixture("calls-api/failed-unreachable-403.json");
  (payload.recipients as Array<{ attempts: Array<{ failure_code: string | null }> }>)[0]!
    .attempts[0]!.failure_code = null;
  assert.equal(normalize(payload).endstate.value, "unknown");
});

test("confidence cannot separate a real success from a false one", () => {
  const real = fixture("calls-api/completed-genuine-success.json") as {
    completion_confidence: { score: number; label: string };
  };
  const false_ = fixture("calls-api/completed-voicemail-task-completed.json") as {
    completion_confidence: { score: number; label: string };
  };

  // One payload answered the question. The other reached an answering machine
  // and answered nothing. Both report the task complete, both are labelled
  // high, and their scores sit next to each other.
  assert.equal(real.completion_confidence.label, false_.completion_confidence.label);
  assert.ok(Math.abs(real.completion_confidence.score - false_.completion_confidence.score) < 0.05);

  // So nothing in this library is allowed to branch on either field.
  for (const name of [
    "calls-api/completed-genuine-success.json",
    "calls-api/completed-voicemail-task-completed.json",
  ]) {
    const d = normalize(fixture(name));
    assert.ok(
      !d.endstate.from.some((f) => f.includes("confidence")) &&
        !d.taskOutcome.from.some((f) => f.includes("confidence")) &&
        !d.resultState.from.some((f) => f.includes("confidence")),
      `${name} must not read completion_confidence`,
    );
  }
});

test("a real success is read as met, and still wants a person", () => {
  const d = normalize(fixture("calls-api/completed-genuine-success.json"));
  assert.equal(d.taskOutcome.value, "met");
  assert.equal(d.resultState.value, "valid", "the other side spoke, so the result is sourced");
  assert.equal(d.endstate.value, "answered_unspecified");

  // A recording answered, not a person, and the payload cannot say which. The
  // reading says exactly that rather than waving it through because the task
  // happened to succeed.
  assert.equal(d.needsHuman, true);
  assert.ok(d.reasons.some((r) => /was ever on the line/.test(r)));
});
