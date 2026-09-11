// End-to-end drill against the local fake CALL-E server: no network, no credentials, no call.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { CalleClient } from "@call-e/calle";
import { loadConfig } from "../src/config.js";
import { startFakeCalleServer, type FakeServerHandle } from "../src/fake-calle-server.js";
import { Ledger } from "../src/ledger.js";
import { CallInbox, Orchestrator } from "../src/orchestrator.js";
import { loadPlaybook } from "../src/playbooks.js";
import { loadRegistry } from "../src/registry.js";
import { buildReport } from "../src/report.js";
import { startServer, toPublicState, type ServerHandle } from "../src/server.js";
import type { HazardEvent } from "../src/types.js";

let fake: FakeServerHandle;
let server: ServerHandle;
let dir: string;
const inbox = new CallInbox();

before(async () => {
  fake = await startFakeCalleServer({ port: 0, queueDelayMs: 50, perRecipientMs: 30 });
  dir = mkdtempSync(join(tmpdir(), "canopy-e2e-"));
  server = await startServer({
    config: loadConfig({ CANOPY_MODE: "dry-run", CANOPY_PORT: "0", CANOPY_FAKE_PORT: String(fake.port), CANOPY_DATA_DIR: dir }),
    inbox,
    publicDir: join(process.cwd(), "public"),
  });
});

after(async () => {
  await server.close();
  await fake.close();
  rmSync(dir, { recursive: true, force: true });
});

test("a full dry-run drill classifies everyone, cascades, and writes a reproducible report", async () => {
  const config = loadConfig({ CANOPY_MODE: "dry-run", CANOPY_PORT: "0", CANOPY_FAKE_PORT: String(fake.port), CANOPY_DATA_DIR: dir, CANOPY_ORG: "Test County", CANOPY_EMERGENCY_NUMBER: "911" });
  const client = new CalleClient({ apiKey: "dry-run", baseUrl: fake.url });
  const { people, report } = loadRegistry(join(process.cwd(), "data", "registry.sample.csv"));
  assert.equal(people.length, 8, "sample registry has 8 consented, unique people");
  assert.equal(report.skippedNoConsent, 1);
  assert.equal(report.skippedDuplicatePhone, 1);

  const event: HazardEvent = {
    id: "heat-e2e",
    hazard: "heat",
    area: "Maricopa County, AZ",
    severity: "Extreme",
    headline: "Extreme Heat Warning",
    source: "drill",
    startedAt: new Date().toISOString(),
    org: config.org,
    emergencyNumber: config.emergencyNumber,
    resource: null,
  };
  const ledger = new Ledger(join(dir, event.id, "ledger.jsonl"));
  server.setLedger(ledger);
  const orchestrator = new Orchestrator({
    config,
    client,
    ledger,
    inbox,
    event,
    playbook: loadPlaybook("heat"),
    people,
    registryReport: report,
    webhookUrl: `${server.url}/calle/webhook`,
    waveSize: 3,
    parallelWaves: 2,
    pollIntervalMs: 40,
    retryDelayMs: 0,
  });
  const summary = await orchestrator.run();

  assert.deepEqual(summary.outcomes, { green: 3, yellow: 1, red: 2, declined: 0, unreachable: 1, unverified: 1, not_attempted: 0, pending: 0 });
  const states = ledger.projection.states;
  assert.equal(states.get("p001")?.outcome, "red");
  assert.equal(states.get("p002")?.outcome, "red", "confusion overrides the agent's yellow");
  assert.equal(states.get("p002")?.agentTier, "yellow");
  assert.equal(states.get("p003")?.outcome, "yellow");
  assert.equal(states.get("p004")?.outcome, "green", "caregiver answering is accepted");
  assert.equal(states.get("p005")?.outcome, "unreachable");
  assert.equal(states.get("p005")?.attempts, 2, "unreachable people are redialled once");
  assert.equal(states.get("p007")?.outcome, "green");
  assert.equal(states.get("p008")?.outcome, "unverified");
  assert.equal(states.get("p008")?.attempts, 2);

  // Escalations: p001 (red, contact asks for EMS), p002 (red, contact commits), p005 (unreachable, contact commits). p008 has no contact.
  assert.equal(summary.escalationCalls, 3);
  assert.equal(states.get("p001")?.contactResult?.wants_emergency_services, "yes");
  assert.equal(states.get("p005")?.contactResult?.will_check, "yes");
  const tickets = [...ledger.projection.dispatches.values()];
  assert.ok(tickets.some((t) => t.kind === "emergency_services" && t.personId === "p001" && t.needsHumanApproval));
  assert.ok(tickets.some((t) => t.kind === "contact_committed" && t.personId === "p005"));
  assert.ok(tickets.some((t) => t.kind === "door_knock" && t.personId === "p008"));

  // Webhooks were delivered and de-duplicated; timeline carries developer events.
  assert.ok(ledger.projection.timeline.some((t) => t.message.includes("Webhook call.completed received")));
  assert.ok(ledger.projection.timeline.some((t) => t.message.includes("Dialing recipient")));

  // Idempotency: the same wave key returns the same call, never a second dial.
  const calls = [...ledger.projection.calls.values()];
  const keys = calls.map((c) => c.idempotencyKey);
  assert.equal(new Set(keys).size, keys.length);
  const replay = await client.calls.create({ task: "replay", recipients: [{ phones: ["+14155550101"] }] }, { idempotencyKey: keys[0] ?? "missing" });
  assert.equal(replay.id, calls[0]?.callId);

  // Report is reproducible from the ledger alone and masks every phone number.
  const markdown = buildReport(ledger.projection);
  assert.ok(markdown.includes("| Red (human escalation) | 2 |"));
  assert.ok(!/\+1415\d{7}/.test(markdown));
  assert.ok(markdown.includes("In their words"));
  const replayed = new Ledger(join(dir, event.id, "ledger.jsonl"));
  assert.equal(buildReport(replayed.projection), markdown);

  // Public state masks numbers and exposes KPIs.
  const state = toPublicState(ledger.projection, "dry-run") as { kpis: { reached: number }; people: { maskedPhone: string }[] };
  assert.equal(state.kpis.reached, 6);
  assert.ok(state.people.every((p) => p.maskedPhone.includes("*")));

  // The dashboard API serves the same state.
  const response = await fetch(`${server.url}/api/state`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as { kpis: { red: number } };
  assert.equal(body.kpis.red, 2);
  const raw = readFileSync(join(dir, event.id, "ledger.jsonl"), "utf8");
  assert.ok(raw.split("\n").length > 20);
});

test("the webhook receiver rejects a mismatched CALL-E-Event-Id and de-duplicates", async () => {
  const bad = await fetch(`${server.url}/calle/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "CALL-E-Event-Id": "evt_other" },
    body: JSON.stringify({ id: "evt_1", type: "call.completed", data: { id: "call_x" } }),
  });
  assert.equal(bad.status, 400);
  const first = await fetch(`${server.url}/calle/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "CALL-E-Event-Id": "evt_dup" },
    body: JSON.stringify({ id: "evt_dup", type: "call.completed", data: { id: "call_x" } }),
  });
  assert.equal(first.status, 200);
  const second = await fetch(`${server.url}/calle/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "CALL-E-Event-Id": "evt_dup" },
    body: JSON.stringify({ id: "evt_dup", type: "call.completed", data: { id: "call_x" } }),
  });
  assert.deepEqual(await second.json(), { received: true, duplicate: true });
});

test("live runs can never be started from the dashboard", async () => {
  const liveServer = await startServer({
    config: loadConfig({ CANOPY_MODE: "live", CALLE_API_KEY: "iams_live_test", CANOPY_PORT: "0" }),
    inbox: new CallInbox(),
    publicDir: join(process.cwd(), "public"),
    startDrill: async () => ({ eventId: "never" }),
  });
  try {
    const response = await fetch(`${liveServer.url}/api/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hazard: "heat", area: "x" }) });
    assert.equal(response.status, 403);
  } finally {
    await liveServer.close();
  }
});
