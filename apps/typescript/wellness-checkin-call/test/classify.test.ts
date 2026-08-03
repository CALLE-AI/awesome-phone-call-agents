import assert from "node:assert/strict";
import test from "node:test";
import { classifyWellnessResult } from "../src/classify.js";

test("no structured result escalates", () => {
  const result = classifyWellnessResult(null);
  assert.equal(result.level, "escalate");
});

test("no answer escalates", () => {
  const result = classifyWellnessResult({ answered: false });
  assert.equal(result.level, "escalate");
});

test("everything fine is ok", () => {
  const result = classifyWellnessResult({
    answered: true,
    condition_summary: "feeling good",
    meal_status: "good",
    concerns_reported: false,
  });
  assert.equal(result.level, "ok");
});

test("a lone reported concern is mild, not escalate", () => {
  const result = classifyWellnessResult({
    answered: true,
    condition_summary: "feeling fine",
    meal_status: "good",
    concerns_reported: true,
    concerns_detail: "needs more light bulbs",
  });
  assert.equal(result.level, "mild_concern");
});

test("a concerning meal status alone is mild", () => {
  const result = classifyWellnessResult({
    answered: true,
    condition_summary: "feeling fine",
    meal_status: "somewhat_concerning",
    concerns_reported: false,
  });
  assert.equal(result.level, "mild_concern");
});

test("a concerning condition keyword alone is mild", () => {
  const result = classifyWellnessResult({
    answered: true,
    condition_summary: "a bit dizzy today",
    meal_status: "good",
    concerns_reported: false,
  });
  assert.equal(result.level, "mild_concern");
  assert.match(result.reasons[0]!, /dizzy/);
});

test("a concern plus a concerning condition escalates", () => {
  const result = classifyWellnessResult({
    answered: true,
    condition_summary: "some pain in my leg",
    meal_status: "good",
    concerns_reported: true,
    concerns_detail: "can't get to the pharmacy",
  });
  assert.equal(result.level, "escalate");
  assert.equal(result.reasons.length, 2);
});

test("a concern plus a concerning meal status escalates", () => {
  const result = classifyWellnessResult({
    answered: true,
    condition_summary: "feeling fine",
    meal_status: "somewhat_concerning",
    concerns_reported: true,
    concerns_detail: "ran out of groceries",
  });
  assert.equal(result.level, "escalate");
});
