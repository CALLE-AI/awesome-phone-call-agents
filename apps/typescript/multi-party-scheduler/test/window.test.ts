/**
 * The window a confirmation has to land inside.
 *
 * The check that matters is the one after the result comes back. A call placed
 * with a minute of window left can answer an hour later and an idempotency key
 * replayed on a later run hands back an answer from a window that closed long
 * ago. Both are late and neither is a confirmation.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { CLOCK_SKEW_MS, decidedInWindow, judgeWindow } from "../src/window.js";

const windowStart = Date.parse("2026-08-04T17:00:00Z");
const deadline = windowStart + 45 * 60_000;

function landed(completedAt: unknown, now: number): boolean {
  return decidedInWindow({ completedAt, windowStart, deadline, now });
}

function reasonFor(completedAt: unknown, now: number): string | null {
  return judgeWindow({ completedAt, windowStart, deadline, now }).reason;
}

test("an answer inside the window on both clocks is inside it", () => {
  assert.equal(landed("2026-08-04T17:20:00Z", windowStart + 20 * 60_000), true);
});

test("a result that comes back after the window closed is outside it", () => {
  assert.equal(landed("2026-08-04T17:44:00Z", deadline + 1), false);
  assert.equal(landed(null, deadline + 1), false);
});

test("a call that finished outside this window is outside it, whatever the local clock says", () => {
  // What a replayed idempotency key returns: the answer is final and it is from
  // a round that ended two hours ago.
  assert.equal(landed("2026-08-04T15:01:20Z", windowStart + 60_000), false);
  assert.equal(landed("2026-08-04T18:30:00Z", windowStart + 60_000), false);
});

test("a minute of provider clock skew is tolerated at both ends", () => {
  assert.equal(CLOCK_SKEW_MS, 60_000);
  assert.equal(landed(new Date(windowStart - 30_000).toISOString(), windowStart + 1000), true);
  assert.equal(landed(new Date(deadline + 30_000).toISOString(), deadline - 1000), true);
  assert.equal(landed(new Date(windowStart - 90_000).toISOString(), windowStart + 1000), false);
});

test("a provider completion time that is missing or malformed fails closed", () => {
  const inside = windowStart + 60_000;
  const unusable: [string, unknown][] = [
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["blank", "   "],
    ["garbage text", "some time on Thursday"],
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
    ["a number of milliseconds", inside],
    ["a Date", new Date(inside)],
    ["an object", { completed_at: "2026-08-04T17:20:00Z" }],
  ];
  for (const [label, completedAt] of unusable) {
    const verdict = judgeWindow({ completedAt, windowStart, deadline, now: inside });
    assert.equal(verdict.within, false, `${label} must not satisfy the window`);
    assert.equal(verdict.reason, "completion_time_unknown", label);
    assert.equal(verdict.completionTimeUsable, false, label);
  }
});

test("the completion time is checked before either clock", () => {
  // Otherwise a record can say the window was checked against a time nobody
  // could read.
  const late = judgeWindow({ completedAt: null, windowStart, deadline, now: deadline + 1 });
  assert.equal(late.reason, "completion_time_unknown");
  const noSpan = judgeWindow({ completedAt: "", windowStart: Number.NaN, deadline, now: windowStart });
  assert.equal(noSpan.reason, "completion_time_unknown");
});

test("each refusal carries its own reason", () => {
  const good = judgeWindow({
    completedAt: "2026-08-04T17:20:00Z",
    windowStart,
    deadline,
    now: windowStart + 20 * 60_000,
  });
  assert.equal(good.reason, null);
  assert.equal(good.completionTimeUsable, true);
  assert.equal(reasonFor("2026-08-04T17:44:00Z", deadline + 1), "late_result");
  assert.equal(reasonFor("2026-08-04T15:01:20Z", windowStart + 60_000), "outside_window");
  assert.equal(reasonFor("2026-08-04T17:20:00Z", Number.NaN), "no_window");
  assert.equal(
    judgeWindow({ completedAt: "2026-08-04T17:20:00Z", windowStart: Number.NaN, deadline, now: windowStart }).reason,
    "no_window",
  );
});
