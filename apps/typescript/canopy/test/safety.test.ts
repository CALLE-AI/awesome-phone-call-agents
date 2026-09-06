// Quiet hours, dashboard token, feed evaluation.

import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { evaluatePsi, parsePsiPayload } from "../src/feeds/nea-psi.js";
import { CallInbox } from "../src/orchestrator.js";
import { loadPlaybooks } from "../src/playbooks.js";
import { formatWindow, isQuietNow, localMinutes, minutesUntilQuietEnds, parseQuietHours, resolveTimeZone } from "../src/quiet-hours.js";
import { startServer } from "../src/server.js";
import { join } from "node:path";

test("quiet hours parse, wrap midnight, and report time remaining", () => {
  const window = parseQuietHours("21:00-07:00");
  assert.deepEqual(window, { startMinutes: 1260, endMinutes: 420 });
  assert.equal(formatWindow(window), "21:00-07:00");
  assert.equal(parseQuietHours("none"), null);
  assert.throws(() => parseQuietHours("9pm-7am"));
  // 2026-07-04T23:30Z is 23:30 in UTC
  const late = new Date("2026-07-04T23:30:00Z");
  const noon = new Date("2026-07-04T12:00:00Z");
  const early = new Date("2026-07-04T05:59:00Z");
  assert.equal(localMinutes(late, "UTC"), 23 * 60 + 30);
  assert.equal(isQuietNow(late, window, "UTC"), true);
  assert.equal(isQuietNow(early, window, "UTC"), true);
  assert.equal(isQuietNow(noon, window, "UTC"), false);
  assert.equal(minutesUntilQuietEnds(late, window, "UTC"), 7 * 60 + 30);
  assert.equal(minutesUntilQuietEnds(noon, window, "UTC"), 0);
  // Same instant is daytime in Kolkata (05:00 IST is quiet, 12:00 IST is not)
  assert.equal(isQuietNow(new Date("2026-07-04T23:30:00Z"), window, "Asia/Kolkata"), true);
  assert.equal(isQuietNow(new Date("2026-07-04T06:30:00Z"), window, "Asia/Kolkata"), false);
  assert.equal(isQuietNow(noon, null, "UTC"), false);
});

test("time zones are validated and default to the system zone", () => {
  assert.equal(resolveTimeZone("Asia/Singapore"), "Asia/Singapore");
  assert.throws(() => resolveTimeZone("Mars/Olympus"));
  assert.ok(resolveTimeZone(undefined).length > 0);
  const config = loadConfig({ CANOPY_QUIET_HOURS: "22:00-06:00", CANOPY_TIMEZONE: "Asia/Singapore" });
  assert.equal(formatWindow(config.quietHours), "22:00-06:00");
  assert.equal(config.timeZone, "Asia/Singapore");
});

test("only life-safety playbooks may override quiet hours; the flag is data, not code", () => {
  const playbooks = loadPlaybooks();
  assert.equal(playbooks.get("heat")?.life_safety, true);
  assert.equal(playbooks.get("outage-medical")?.life_safety, true);
  assert.equal(playbooks.get("boil-water")?.life_safety, false);
});

test("live defaults to per-person tasks; dry-run defaults to batch; the env can override either", () => {
  assert.equal(loadConfig({ CANOPY_MODE: "dry-run" }).taskMode, "batch");
  assert.equal(loadConfig({ CANOPY_MODE: "live", CALLE_API_KEY: "k" }).taskMode, "per-person");
  assert.equal(loadConfig({ CANOPY_MODE: "live", CALLE_API_KEY: "k", CANOPY_TASK_MODE: "batch" }).taskMode, "batch");
  assert.throws(() => loadConfig({ CANOPY_TASK_MODE: "weird" }));
});

test("a public URL forces a dashboard token; the webhook stays open, everything else is closed", async () => {
  const config = loadConfig({ CANOPY_MODE: "dry-run", CANOPY_PORT: "0", CANOPY_PUBLIC_URL: "https://example-tunnel.ngrok.app" });
  assert.ok(config.dashboardToken && config.dashboardToken.length >= 20);
  const server = await startServer({ config, inbox: new CallInbox(), publicDir: join(process.cwd(), "public") });
  try {
    assert.equal((await fetch(`${server.url}/api/state`)).status, 401);
    assert.equal((await fetch(`${server.url}/`)).status, 401);
    assert.equal((await fetch(`${server.url}/api/dispatch/x/approve`, { method: "POST" })).status, 401);
    assert.equal((await fetch(`${server.url}/api/state?token=${config.dashboardToken}`)).status, 200);
    assert.equal((await fetch(`${server.url}/api/state`, { headers: { authorization: `Bearer ${config.dashboardToken}` } })).status, 200);
    const webhook = await fetch(`${server.url}/calle/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "CALL-E-Event-Id": "evt_open" },
      body: JSON.stringify({ id: "evt_open", type: "call.completed", data: { id: "call_x" } }),
    });
    assert.equal(webhook.status, 200);
    const page = await fetch(`${server.url}/?token=${config.dashboardToken}`);
    assert.equal(page.status, 200);
    assert.ok((page.headers.get("set-cookie") ?? "").includes("canopy_token="));
  } finally {
    await server.close();
  }
});

test("an explicit CANOPY_DASHBOARD_TOKEN is honoured and no token means an open local dashboard", async () => {
  assert.equal(loadConfig({ CANOPY_DASHBOARD_TOKEN: "s3cret" }).dashboardToken, "s3cret");
  assert.equal(loadConfig({}).dashboardToken, null);
});

test("Singapore NEA PSI payload parses and the smoke playbook triggers at 24-hour PSI 100", () => {
  const smoke = loadPlaybooks().get("smoke");
  assert.ok(smoke);
  const payload = { code: 0, data: { items: [{ timestamp: "2026-09-06T10:00:00+08:00", readings: { psi_twenty_four_hourly: { west: 62, east: 58, central: 61, south: 104, north: 66 } } }] } };
  const snapshot = parsePsiPayload(payload);
  assert.equal(snapshot.readings.length, 5);
  const event = evaluatePsi(snapshot, smoke, "NEA", "995");
  assert.equal(event?.hazard, "smoke");
  assert.equal(event?.area, "Singapore (south)");
  assert.equal(event?.source, "nea-psi");
  const calm = parsePsiPayload({ data: { items: [{ readings: { psi_twenty_four_hourly: { west: 40, east: 45 } } }] } });
  assert.equal(evaluatePsi(calm, smoke, "NEA", "995"), null);
  assert.equal(evaluatePsi(parsePsiPayload({}), smoke, "NEA", "995"), null);
});
