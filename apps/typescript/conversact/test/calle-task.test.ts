import assert from "node:assert/strict";
import test from "node:test";
import { buildCallPlan, buildResultSchema, buildTask } from "../src/calle.js";

test("task constrains the commerce conversation and schema excludes money", () => {
  const task = buildTask([{ id: "coffee-small", name: "Small Coffee" }]);
  assert.match(task, /Never invent prices/);
  assert.match(task, /Never claim payment has happened/);
  const schema = buildResultSchema();
  assert.equal(schema.properties?.price, undefined);
  assert.equal(schema.properties?.total, undefined);
  assert.equal(schema.additionalProperties, false);
});

test("call plan binds only non-sensitive workflow metadata", () => {
  const plan = buildCallPlan({ sessionId: "cv_test_001", recipientPhone: "+14155550100", catalog: [{ id: "coffee-small", name: "Small Coffee" }] });
  assert.deepEqual(plan.metadata, { workflow: "conversact", workflow_version: "1", session_id: "cv_test_001" });
  assert.equal(plan.idempotencyKey, "conversact:cv_test_001:call:v1");
});
