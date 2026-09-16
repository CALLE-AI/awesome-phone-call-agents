import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCallTask, RESULT_SCHEMA } from "../src/call-task.js";
import { recallFixture } from "./fixtures.js";

test("call task contains disclosure, privacy, no-purchase, and uncertainty gates", () => {
  const task = buildCallTask(recallFixture, "MODEL-A", "BATCH-7");
  assert.match(task, /automated assistant/i);
  assert.match(task, /Do not ask for or disclose/i);
  assert.match(task, /Do not purchase/i);
  assert.match(task, /Treat ambiguity as unknown/i);
  assert.match(task, /BATCH-7/);
});

test("result schema is strict and requires the action fields", () => {
  assert.equal(RESULT_SCHEMA.additionalProperties, false);
  assert.ok(RESULT_SCHEMA.required.includes("eligibility"));
  assert.ok(RESULT_SCHEMA.required.includes("next_step"));
  assert.ok(RESULT_SCHEMA.required.includes("confidence"));
});
