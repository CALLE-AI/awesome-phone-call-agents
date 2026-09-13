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
  store.recordVerification({ lineId: "main-office", phone: "+15550100", method: "greeting_code", verifiedAt: "2026-08-02T00:00:00Z", callId: "cv" });

  const state = buildDashboardState(config(), store, () => new Date("2026-08-02T12:00:00Z"));

  assert.equal(state.generatedAt, "2026-08-02T12:00:00.000Z");
  const office = state.lines[0];
  assert.equal(office.health, "attention");
  assert.equal(office.maskedPhone.includes("5550100"), false);
  assert.equal(office.verification?.method, "greeting_code");

  const hours = office.checks.find((check) => check.id === "hours")!;
  assert.equal(hours.latest?.callId, "c2");
  assert.equal(hours.history.length, 2);
  assert.deepEqual(hours.regressions.map((entry) => entry.kind), ["new_failure"]);
  assert.deepEqual(hours.answerSeconds, [5, 5]);
  assert.equal(hours.stale, false);
  assert.equal(hours.pending, false);

  const quiet = state.lines[1];
  assert.equal(quiet.health, "stale");
  assert.equal(quiet.checks[0].latest, null);
  assert.equal(quiet.verification, null);

  assert.equal(state.allClear, false);
});

test("allClear needs a fresh pass on every check — never-run checks are monitoring gaps", () => {
  const store = openStore(join(mkdtempSync(join(tmpdir(), "linecanary-state-")), "baselines"));
  store.append(outcome({ checkId: "hours" }));
  store.append(outcome({ checkId: "menu" }));
  const state = buildDashboardState(config(), store, () => new Date("2026-08-02T12:00:00Z"));
  assert.equal(state.lines[0].health, "ok");
  assert.equal(state.lines[1].health, "stale");
  assert.equal(state.allClear, false);

  // Without the never-run check, the same store is all clear.
  const trimmed: Config = { ...config(), lines: [config().lines[0]], checks: config().checks.slice(0, 2) };
  const clear = buildDashboardState(trimmed, store, () => new Date("2026-08-02T12:00:00Z"));
  assert.equal(clear.lines[0].health, "ok");
  assert.equal(clear.allClear, true);
});

test("a check whose latest run is older than 26 hours goes stale, never green", () => {
  const store = openStore(join(mkdtempSync(join(tmpdir(), "linecanary-state-")), "baselines"));
  store.append(outcome({ checkId: "hours", at: "2026-08-01T00:00:00Z" }));
  store.append(outcome({ checkId: "menu", at: "2026-08-02T10:00:00Z" }));
  const state = buildDashboardState(config(), store, () => new Date("2026-08-02T12:00:00Z"));
  const office = state.lines[0];
  assert.equal(office.checks.find((check) => check.id === "hours")!.stale, true);
  assert.equal(office.checks.find((check) => check.id === "menu")!.stale, false);
  assert.equal(office.health, "stale");
  assert.equal(state.allClear, false);
});

test("a stored pending attempt surfaces on its check", () => {
  const store = openStore(join(mkdtempSync(join(tmpdir(), "linecanary-state-")), "baselines"));
  store.append(outcome({ checkId: "hours" }));
  store.recordPending({ checkId: "hours", idempotencyKey: "k1", callId: null, at: "2026-08-02T11:00:00Z" });
  const state = buildDashboardState(config(), store, () => new Date("2026-08-02T12:00:00Z"));
  const office = state.lines[0];
  assert.equal(office.checks.find((check) => check.id === "hours")!.pending, true);
  assert.equal(office.checks.find((check) => check.id === "menu")!.pending, false);
});

test("callsToday counts calendar days in the call-window timezone", () => {
  const store = openStore(join(mkdtempSync(join(tmpdir(), "linecanary-state-")), "baselines"));
  // 23:00 UTC on Aug 2 is late afternoon Aug 2 in Los Angeles; the "now"
  // below is already Aug 3 in UTC but still Aug 2 evening in Los Angeles.
  store.append(outcome({ checkId: "hours", at: "2026-08-02T23:00:00Z" }));
  const now = () => new Date("2026-08-03T02:00:00Z");
  const utc = buildDashboardState(config(), store, now);
  assert.equal(utc.timezone, undefined);
  assert.equal(utc.totals.callsToday, 0);
  const zoned = buildDashboardState(
    { ...config(), callWindow: { timezone: "America/Los_Angeles", start: "09:00", end: "17:00" } },
    store,
    now,
  );
  assert.equal(zoned.timezone, "America/Los_Angeles");
  assert.equal(zoned.totals.callsToday, 1);
});
