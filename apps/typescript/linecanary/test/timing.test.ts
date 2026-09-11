import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTiming } from "../src/timing.js";
import type { TranscriptTurn } from "../src/types.js";

function turn(speaker: "bot" | "user", offsetSeconds: number | null, text = "…"): TranscriptTurn {
  return { speaker, offsetSeconds, text };
}

test("measures answer and first-response timing from turn offsets", () => {
  const timing = extractTiming([
    turn("bot", 0, "This is an automated test call."),
    turn("user", 6, "Front desk."),
    turn("bot", 9, "What are your Saturday hours?"),
    turn("user", 14, "Nine to noon."),
  ]);
  assert.equal(timing.secondsToAnswer, 6);
  assert.equal(timing.secondsToFirstResponse, 6);
  assert.equal(timing.turnCount, 4);
});

test("user speaking first counts as the answer at its own offset", () => {
  const timing = extractTiming([turn("user", 2, "Hello?"), turn("bot", 4, "Hi.")]);
  assert.equal(timing.secondsToAnswer, 2);
  // No bot turn preceded the user, so first-response is the same event.
  assert.equal(timing.secondsToFirstResponse, 2);
});

test("no user turn yields null metrics", () => {
  const timing = extractTiming([turn("bot", 0), turn("bot", 12)]);
  assert.equal(timing.secondsToAnswer, null);
  assert.equal(timing.secondsToFirstResponse, null);
  assert.equal(timing.turnCount, 2);
});

test("null offsets are skipped rather than treated as zero", () => {
  const timing = extractTiming([turn("bot", null), turn("user", null), turn("user", 8)]);
  assert.equal(timing.secondsToAnswer, 8);
  assert.equal(timing.turnCount, 3);
});

test("empty transcript yields nulls and zero turns", () => {
  const timing = extractTiming([]);
  assert.equal(timing.secondsToAnswer, null);
  assert.equal(timing.secondsToFirstResponse, null);
  assert.equal(timing.turnCount, 0);
});
