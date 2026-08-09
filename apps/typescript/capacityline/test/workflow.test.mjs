import assert from "node:assert/strict";
import test from "node:test";
import { buildPayload, buildTask, recipientResultSchema } from "../src/workflow.mjs";

test("call task states disclosure and commercial limits", () => {
  const task = buildTask();
  assert.match(task, /Identify yourself as an AI/);
  assert.match(task, /Do not place an order/);
  assert.match(task, /Return unknown instead of guessing/);
});

test("payload preserves supplier ordering and human approval metadata", () => {
  const payload = buildPayload([
    { id: "supplier-1", phone: "+1555010100", region: "US", locale: "en-US" },
  ]);
  assert.deepEqual(payload.metadata.supplier_ids, ["supplier-1"]);
  assert.equal(payload.metadata.human_approval_required, true);
  assert.equal(recipientResultSchema.additionalProperties, false);
});
