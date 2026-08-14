// Tests for the acknowledgment evaluation — the core "fail toward escalation" rule.
// Run: node --test --experimental-strip-types scripts/run_escalation.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretAck } from "./run_escalation.ts";

test("confident completion → acknowledged", () => {
  const r = interpretAck("COMPLETED", { summary: "Got it, I'll hold him.", outcome: { task_completed: true, completion_confidence: { label: "high", score: 0.84 } } }, "trainer");
  assert.equal(r.acknowledged, true);
  assert.equal(r.reached, true);
});

test("low confidence → NOT acknowledged (fail toward escalation)", () => {
  const r = interpretAck("COMPLETED", { summary: "Unclear response.", outcome: { task_completed: true, completion_confidence: { label: "low", score: 0.3 } } }, "trainer");
  assert.equal(r.acknowledged, false);
});

test("no answer / voicemail / declined → NOT acknowledged", () => {
  for (const s of ["NO_ANSWER", "VOICEMAIL", "BUSY", "DECLINED"]) {
    assert.equal(interpretAck(s, {}, "trainer").acknowledged, false);
  }
});

test("explicit acknowledged=false is respected", () => {
  const r = interpretAck("COMPLETED", { acknowledged: false, reached: true, summary: "Refused." }, "physician");
  assert.equal(r.acknowledged, false);
});

test("unavailable (CALL-E not reachable) → NOT acknowledged", () => {
  assert.equal(interpretAck("unavailable", { note: "CALL-E not available" }, "trainer").acknowledged, false);
});
