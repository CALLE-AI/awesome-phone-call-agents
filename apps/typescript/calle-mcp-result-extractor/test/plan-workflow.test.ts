import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

// See test/pending-plan.test.ts — must be set before pending-plan.js loads.
const stateDir = mkdtempSync(join(tmpdir(), "calle-mcp-result-extractor-test-"));
process.env.CALLE_MCP_APP_STATE_DIR = stateDir;

const { clearPendingPlan, loadPendingPlan } = await import("../src/pending-plan.js");
const { planAndSave } = await import("../src/plan-workflow.js");

const FAKE_CONFIG = { cacheRoot: stateDir, serverUrl: "https://example.invalid", timeoutSeconds: 5 };
const VALID_REQUEST = { to: "+15555550123", region: "US", goal: "Confirm the appointment." };

function readyPlan(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    plan_id: "plan_new",
    ready_to_run: true,
    next_step: "run_call",
    confirm_summary: "Call +15555550123 to confirm.",
    confirm_token: "token_new",
    ...overrides,
  };
}

beforeEach(() => {
  clearPendingPlan();
});

afterEach(() => {
  clearPendingPlan();
});

test("a ready plan is saved as the pending plan", async () => {
  const plan = await planAndSave(FAKE_CONFIG, VALID_REQUEST, async () => readyPlan());

  assert.equal(plan.ready_to_run, true);
  const pending = loadPendingPlan();
  assert.equal(pending?.planId, "plan_new");
  assert.equal(pending?.confirmToken, "token_new");
});

test("re-planning after a ready plan clears the old plan even if the new attempt is not ready", async () => {
  await planAndSave(FAKE_CONFIG, VALID_REQUEST, async () => readyPlan({ plan_id: "plan_A", confirm_token: "token_A" }));
  assert.equal(loadPendingPlan()?.planId, "plan_A"); // sanity check the first plan really saved

  const plan = await planAndSave(FAKE_CONFIG, VALID_REQUEST, async () =>
    readyPlan({
      plan_id: "plan_B",
      ready_to_run: false,
      confirm_token: null,
      next_step: "needs clarification",
    }),
  );

  assert.equal(plan.ready_to_run, false);
  // The critical assertion: plan A must not still be sitting there
  // authorized just because plan B wasn't ready.
  assert.equal(loadPendingPlan(), null);
});

test("re-planning clears the old plan even when the new attempt throws", async () => {
  await planAndSave(FAKE_CONFIG, VALID_REQUEST, async () => readyPlan({ plan_id: "plan_A", confirm_token: "token_A" }));
  assert.equal(loadPendingPlan()?.planId, "plan_A");

  await assert.rejects(
    planAndSave(FAKE_CONFIG, VALID_REQUEST, async () => {
      throw new Error("simulated network failure");
    }),
  );

  assert.equal(loadPendingPlan(), null);
});

test("re-planning clears the old plan even when the new --to fails local E.164 validation", async () => {
  await planAndSave(FAKE_CONFIG, VALID_REQUEST, async () => readyPlan({ plan_id: "plan_A", confirm_token: "token_A" }));
  assert.equal(loadPendingPlan()?.planId, "plan_A");

  await assert.rejects(
    planAndSave(FAKE_CONFIG, { ...VALID_REQUEST, to: "not-a-phone" }, async () => readyPlan()),
    /must be an E\.164 phone number/,
  );

  assert.equal(loadPendingPlan(), null);
});

test("a plan that is not ready to run is never saved", async () => {
  const plan = await planAndSave(FAKE_CONFIG, VALID_REQUEST, async () =>
    readyPlan({ ready_to_run: false, confirm_token: null, next_step: "needs clarification" }),
  );

  assert.equal(plan.ready_to_run, false);
  assert.equal(loadPendingPlan(), null);
});

process.on("exit", () => {
  rmSync(stateDir, { recursive: true, force: true });
});
