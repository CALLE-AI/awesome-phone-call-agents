import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/baseline.js";
import { buildDashboardState } from "../src/state.js";
import { outcome } from "./baseline.test.js";
import type { Config } from "../src/config.js";

function config(): Config {
  return {
    lines: [
      { id: "main-office", phone: "+15550100", ownership: { method: "greeting_code", code: "LC-1" } },
      { id: "quiet-line", phone: "+15550101", ownership: { method: "attestation", statement: "…" } },
    ],
    checks: [
      { id: "hours", line: "main-office", task: "Ask hours.", resultSchema: { type: "object", additionalProperties: false }, assert: [{ path: "a", equals: 1 }] },
      { id: "menu", line: "main-office", task: "Listen to menu.", resultSchema: { type: "object", additionalProperties: false }, assert: [{ path: "b", equals: 2 }] },
      { id: "never-ran", line: "quiet-line", task: "…", resultSchema: { type: "object", additionalProperties: false }, assert: [{ path: "c", equals: 3 }] },
    ],
    baselineDir: "unused",
    historyLimit: 200,
  };
}

test("assembles per-line health, latest outcomes and regression views", () => {
  const store = openStore(join(mkdtempSync(join(tmpdir(), "linecanary-state-")), "baselines"));
  store.append(outcome({ checkId: "hours", callId: "c1" }));
  store.append(outcome({ checkId: "hours", callId: "c2", status: "fail" }));
  store.append(outcome({ checkId: "menu", callId: "c3" }));
  store.recordVerification({ lineId: "main-office", phone: "+15550100", method: "greeting_code", verifiedAt: "2026-08-03T00:00:00Z", callId: "cv" });

  const state = buildDashboardState(config(), store, () => new Date("2026-08-03T12:00:00Z"));

  assert.equal(state.generatedAt, "2026-08-03T12:00:00.000Z");
  const office = state.lines[0];
  assert.equal(office.health, "attention");
  assert.equal(office.maskedPhone.includes("5550100"), false);
  assert.equal(office.verification?.method, "greeting_code");

  const hours = office.checks.find((check) => check.id === "hours")!;
  assert.equal(hours.latest?.callId, "c2");
  assert.equal(hours.history.length, 2);
  assert.deepEqual(hours.regressions.map((entry) => entry.kind), ["new_failure"]);
  assert.deepEqual(hours.answerSeconds, [5, 5]);

  const quiet = state.lines[1];
  assert.equal(quiet.health, "unknown");
  assert.equal(quiet.checks[0].latest, null);
  assert.equal(quiet.verification, null);

  assert.equal(state.allClear, false);
});

test("all healthy lines report allClear", () => {
  const store = openStore(join(mkdtempSync(join(tmpdir(), "linecanary-state-")), "baselines"));
  store.append(outcome({ checkId: "hours" }));
  store.append(outcome({ checkId: "menu" }));
  const state = buildDashboardState(config(), store);
  assert.equal(state.lines[0].health, "ok");
  assert.equal(state.allClear, true);
});
