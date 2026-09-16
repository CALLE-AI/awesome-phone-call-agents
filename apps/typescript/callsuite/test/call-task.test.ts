import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CALL_TASK_VARIANTS,
  loadCallTask,
  parseCallTaskVariant,
} from "../src/call-task.js";

describe("CALL-E task variants", () => {
  it("keeps exactly the good and concise-regression versions", () => {
    assert.deepEqual(CALL_TASK_VARIANTS, ["good", "concise-regression"]);
  });

  it("loads the required disclosure into the good task", async () => {
    const task = await loadCallTask("good");

    assert.match(task.content, /cancellations within 24 hours incur a \$25 cancellation fee/i);
    assert.match(task.content, /ask whether they will attend/i);
  });

  it("models the concise regression as an omitted fee disclosure", async () => {
    const task = await loadCallTask("concise-regression");

    assert.match(task.content, /keep the reminder concise/i);
    assert.doesNotMatch(task.content, /\$25|cancellation fee/i);
  });

  it("rejects undeclared variants without reading a file", () => {
    assert.throws(() => parseCallTaskVariant("latest"), /Expected one of/);
  });
});
