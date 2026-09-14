import assert from "node:assert/strict";
import test from "node:test";
import { createPlan, runPlan, type Runner } from "../src/calle.js";
import { compileCallback, type CallbackInput } from "../src/core.js";

const input: CallbackInput = {
  business_name: "Example Repair",
  recipient: { phone: "+12025550147", region: "US", locale: "en-US" },
  objective: "Ask which service window is preferred.",
  consent: { affirmed: true, method: "web_form", recorded_at: "2026-08-07T12:00:00.000Z" },
  facts: [{
    kind: "hours",
    value: "Weekdays 8 to 6",
    source_url: "https://example.com/hours",
    source_quote: "Weekdays 8 to 6",
    source_sha256: "a".repeat(64),
    approved: true
  }]
};

test("planning invokes plan_call and never run_call", async () => {
  const seen: string[][] = [];
  const runner: Runner = async (args) => {
    seen.push(args);
    return { result: { plan_id: "plan_1", confirm_token: "secret", ready_to_run: true } };
  };
  const plan = await createPlan(compileCallback(input), runner);
  assert.equal(plan.plan_id, "plan_1");
  assert.equal(seen.length, 1);
  assert.equal(seen[0][2], "plan_call");
  assert.equal(seen[0].includes("run_call"), false);
});

test("dispatch fails closed without both live enablement and exact approval", async () => {
  let calls = 0;
  const runner: Runner = async () => {
    calls += 1;
    return { result: { run_id: "run_1" } };
  };
  const plan = {
    plan_id: "plan_1",
    confirm_token: "secret",
    approval_phrase: "APPROVE CALL 0147",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    consumed: false
  };
  await assert.rejects(runPlan(plan, "APPROVE CALL 0147", runner, false), /disabled/);
  await assert.rejects(runPlan(plan, "APPROVE CALL 9999", runner, true), /Exact action-time approval/);
  assert.equal(calls, 0);
});

test("a valid live gate invokes run_call exactly once", async () => {
  const seen: string[][] = [];
  const runner: Runner = async (args) => {
    seen.push(args);
    return { result: { run_id: "run_1" } };
  };
  const plan = {
    plan_id: "plan_1",
    confirm_token: "secret",
    approval_phrase: "APPROVE CALL 0147",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    consumed: false
  };
  const result = await runPlan(plan, "APPROVE CALL 0147", runner, true);
  assert.deepEqual(result, { run_id: "run_1", consumed: true });
  assert.equal(seen[0][2], "run_call");
  await assert.rejects(runPlan(plan, "APPROVE CALL 0147", runner, true), /already been consumed/);
  assert.equal(seen.length, 1);
});
