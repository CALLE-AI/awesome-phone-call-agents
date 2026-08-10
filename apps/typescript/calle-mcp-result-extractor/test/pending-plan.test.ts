import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

// CALLE_MCP_APP_STATE_DIR must be set before pending-plan.js is imported —
// it reads the env var once, at module load, when computing the state dir.
const stateDir = mkdtempSync(join(tmpdir(), "calle-mcp-result-extractor-test-"));
process.env.CALLE_MCP_APP_STATE_DIR = stateDir;

const { clearPendingPlan, formatPendingPlanSummary, loadPendingPlan, savePendingPlan } = await import(
  "../src/pending-plan.js"
);

const SAMPLE = {
  planId: "plan_abc123",
  confirmToken: "super-secret-confirm-token",
  toPhones: ["+15555550123"],
  region: "US",
  goal: "Confirm the appointment.",
  createdAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  clearPendingPlan();
});

afterEach(() => {
  clearPendingPlan();
});

test("loadPendingPlan returns null when nothing has been saved", () => {
  assert.equal(loadPendingPlan(), null);
});

test("savePendingPlan then loadPendingPlan round-trips the plan, including the token", () => {
  savePendingPlan(SAMPLE);
  assert.deepEqual(loadPendingPlan(), SAMPLE);
});

test("clearPendingPlan removes the saved plan", () => {
  savePendingPlan(SAMPLE);
  clearPendingPlan();
  assert.equal(loadPendingPlan(), null);
});

test("clearPendingPlan on an already-clear state does not throw", () => {
  assert.doesNotThrow(() => clearPendingPlan());
});

test("the state file is written with owner-only permissions, never world- or group-readable", () => {
  savePendingPlan(SAMPLE);
  const mode = statSync(join(stateDir, "pending-plan.json")).mode & 0o777;
  assert.equal(mode & 0o077, 0, `expected no group/other permissions, got ${mode.toString(8)}`);
});

test("formatPendingPlanSummary shows the plan id, region, and goal, with the phone number masked", () => {
  const summary = formatPendingPlanSummary(SAMPLE);

  assert.match(summary, /plan_abc123/);
  assert.match(summary, /US/);
  assert.match(summary, /Confirm the appointment\./);
  assert.doesNotMatch(summary, /\+15555550123/);
  assert.match(summary, /\+155•+23/); // start and end digits still visible
});

test("formatPendingPlanSummary never leaks the confirm_token", () => {
  const summary = formatPendingPlanSummary(SAMPLE);
  assert.doesNotMatch(summary, /super-secret-confirm-token/);
});

process.on("exit", () => {
  rmSync(stateDir, { recursive: true, force: true });
});
