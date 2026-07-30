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
import { CLOCK_SKEW_MS, decidedInWindow } from "../src/window.js";

const windowStart = Date.parse("2026-08-04T17:00:00Z");
const deadline = windowStart + 45 * 60_000;

function landed(completedAt: string | null, now: number): boolean {
  return decidedInWindow({ completedAt, windowStart, deadline, now });
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

test("no usable completion time leaves the local clock to decide", () => {
  assert.equal(landed(null, windowStart + 1000), true);
  assert.equal(landed("some time on Thursday", windowStart + 1000), true);
  assert.equal(landed("some time on Thursday", deadline + 1000), false);
});
