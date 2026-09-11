import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

// See test/pending-plan.test.ts — must be set before pending-plan.js loads.
const stateDir = mkdtempSync(join(tmpdir(), "calle-mcp-result-extractor-test-"));
process.env.CALLE_MCP_APP_STATE_DIR = stateDir;

const { loadPendingPlan, savePendingPlan } = await import("../src/pending-plan.js");
const { cmdPlan, UsageError } = await import("../src/cli.js");

const STALE_PLAN = {
  planId: "plan_stale",
  confirmToken: "token_stale",
  toPhones: ["+15555550123"],
  region: "US",
  goal: "An earlier, already-reviewed call.",
  createdAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  savePendingPlan(STALE_PLAN); // every test starts with a stale plan already on disk
});

afterEach(() => {
  rmSync(join(stateDir, "pending-plan.json"), { force: true });
});

test("a missing required argument still clears the stale pending plan, before usage() throws", async () => {
  assert.equal(loadPendingPlan()?.planId, "plan_stale"); // sanity check

  await assert.rejects(cmdPlan([]), UsageError); // no --to/--region/--goal at all

  assert.equal(
    loadPendingPlan(),
    null,
    "a plan attempt that never even reaches planCall() must still invalidate the prior authorization",
  );
});

test("a missing single required argument (--goal) still clears the stale pending plan", async () => {
  assert.equal(loadPendingPlan()?.planId, "plan_stale");

  await assert.rejects(cmdPlan(["--to", "+15555550199", "--region", "US"]), UsageError);

  assert.equal(loadPendingPlan(), null);
});

test("a config-resolution failure still clears the stale pending plan, before the network call", async () => {
  assert.equal(loadPendingPlan()?.planId, "plan_stale");

  const resolveConfig = () => {
    throw new Error("simulated config resolution failure");
  };

  await assert.rejects(
    cmdPlan(["--to", "+15555550199", "--region", "US", "--goal", "New goal"], { resolveConfig }),
    /simulated config resolution failure/,
  );

  assert.equal(
    loadPendingPlan(),
    null,
    "a plan attempt that fails before planCall() is ever invoked must still invalidate the prior authorization",
  );
});

test("a fully successful new plan still replaces (not merely clears) the stale plan", async () => {
  assert.equal(loadPendingPlan()?.planId, "plan_stale");

  const plan = await cmdPlanReturningPlan(["--to", "+15555550199", "--region", "US", "--goal", "New goal"], {
    resolveConfig: () => ({ cacheRoot: stateDir, serverUrl: "https://example.invalid", timeoutSeconds: 5 }),
    planCallFn: async () => ({
      plan_id: "plan_new",
      ready_to_run: true,
      next_step: "run_call",
      confirm_summary: "Call +15555550199 to confirm.",
      confirm_token: "token_new",
    }),
  });

  assert.equal(plan.plan_id, "plan_new");
  assert.equal(loadPendingPlan()?.planId, "plan_new");
});

// cmdPlan doesn't return the plan it made (it only prints it) — reach into
// planAndSave's result the same way cmdPlan does, so this last test can
// assert on the end state without parsing captured console output.
async function cmdPlanReturningPlan(
  args: string[],
  deps: Parameters<typeof cmdPlan>[1],
): Promise<{ plan_id: string }> {
  await cmdPlan(args, deps);
  const pending = loadPendingPlan();
  if (!pending) throw new Error("expected a pending plan to have been saved");
  return { plan_id: pending.planId };
}

process.on("exit", () => {
  rmSync(stateDir, { recursive: true, force: true });
});
