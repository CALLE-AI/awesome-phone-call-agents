import { test } from "node:test";
import assert from "node:assert/strict";
import { diffAgainstBaseline } from "../src/diff.js";
import { outcome } from "./baseline.test.js";
import type { CheckOutcome } from "../src/assert.js";

function failing(callId: string, overrides: Partial<CheckOutcome> = {}): CheckOutcome {
  return outcome({
    callId,
    status: "fail",
    assertions: [
      { assertion: { path: "answered", equals: true }, pass: false, actual: false, detail: "expected true, got false" },
    ],
    ...overrides,
  });
}

function passing(callId: string, overrides: Partial<CheckOutcome> = {}): CheckOutcome {
  return outcome({
    callId,
    assertions: [{ assertion: { path: "answered", equals: true }, pass: true, actual: true, detail: "ok" }],
    ...overrides,
  });
}

test("empty history produces no regressions — first run is the baseline", () => {
  assert.deepEqual(diffAgainstBaseline(passing("call_1"), []), []);
  assert.deepEqual(diffAgainstBaseline(failing("call_1"), []), []);
});

test("pass to fail is a new_failure and names the regressed assertion", () => {
  const regressions = diffAgainstBaseline(failing("call_2"), [passing("call_1")]);
  const kinds = regressions.map((entry) => entry.kind).sort();
  assert.deepEqual(kinds, ["assertion_regressed", "new_failure"]);
  const assertionRegression = regressions.find((entry) => entry.kind === "assertion_regressed");
  assert.match(assertionRegression!.detail, /answered/);
});

test("consecutive failures report still_failing, not another new_failure", () => {
  const regressions = diffAgainstBaseline(failing("call_3"), [passing("call_1"), failing("call_2")]);
  assert.deepEqual(regressions.map((entry) => entry.kind), ["still_failing"]);
});

test("fail to pass reports recovered", () => {
  const regressions = diffAgainstBaseline(passing("call_3"), [passing("call_1"), failing("call_2")]);
  assert.deepEqual(regressions.map((entry) => entry.kind), ["recovered"]);
});

test("timing beyond both guards regresses against the pass-run median", () => {
  const history = [4, 5, 6, 5, 4].map((seconds, index) =>
    passing(`call_${index}`, { timing: { secondsToAnswer: seconds, secondsToFirstResponse: seconds, turnCount: 4 } }),
  );
  // Median 5 → threshold max(2×5, 5+10) = 15. 16 regresses…
  const slow = passing("call_slow", { timing: { secondsToAnswer: 16, secondsToFirstResponse: 16, turnCount: 4 } });
  const regressions = diffAgainstBaseline(slow, history);
  assert.deepEqual(regressions.map((entry) => entry.kind), ["timing_regressed"]);
  assert.match(regressions[0].detail, /16/);
  // …while 14 does not.
  const acceptable = passing("call_ok", { timing: { secondsToAnswer: 14, secondsToFirstResponse: 14, turnCount: 4 } });
  assert.deepEqual(diffAgainstBaseline(acceptable, history), []);
});

test("short baselines do not flap on timing", () => {
  const history = [passing("call_1", { timing: { secondsToAnswer: 2, secondsToFirstResponse: 2, turnCount: 4 } })];
  // Median 2 → threshold max(4, 12) = 12. A 10-second answer stays quiet.
  const current = passing("call_2", { timing: { secondsToAnswer: 10, secondsToFirstResponse: 10, turnCount: 4 } });
  assert.deepEqual(diffAgainstBaseline(current, history), []);
});

test("confidence dropping more than 0.2 under the pass-run median regresses", () => {
  const history = [passing("call_1", { confidence: 0.9 }), passing("call_2", { confidence: 0.92 })];
  const shaky = passing("call_3", { confidence: 0.6 });
  const regressions = diffAgainstBaseline(shaky, history);
  assert.deepEqual(regressions.map((entry) => entry.kind), ["confidence_dropped"]);
  const fine = passing("call_4", { confidence: 0.75 });
  assert.deepEqual(diffAgainstBaseline(fine, history), []);
});

test("error outcomes count as failures for transition purposes", () => {
  const errored = outcome({ callId: "call_2", status: "error", failureCode: "no_answer", assertions: [] });
  const regressions = diffAgainstBaseline(errored, [passing("call_1")]);
  assert.deepEqual(regressions.map((entry) => entry.kind), ["new_failure"]);
  assert.match(regressions[0].detail, /no_answer/);
});
