// End-to-end campaign against the local fake CALL-E server: no network, no credentials, no call.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { CalleClient } from "@call-e/calle";
import { loadConfig } from "../src/config.js";
import { startFakeCalleServer, type FakeServerHandle } from "../src/fake-calle-server.js";
import { Ledger } from "../src/ledger.js";
import { CallInbox, Orchestrator } from "../src/orchestrator.js";
import { loadEnrollees } from "../src/registry.js";
import { buildReport } from "../src/report.js";
import { loadRules, loadState } from "../src/rules.js";
import { startServer, toPublicState, type ServerHandle } from "../src/server.js";
import type { Campaign } from "../src/types.js";

let fake: FakeServerHandle;
let server: ServerHandle;
let dir: string;
const inbox = new CallInbox();

before(async () => {
  fake = await startFakeCalleServer({ port: 0, queueDelayMs: 40, perRecipientMs: 25 });
  dir = mkdtempSync(join(tmpdir(), "sc-e2e-"));
  server = await startServer({ config: loadConfig({ SC_MODE: "dry-run", SC_PORT: "0", SC_FAKE_PORT: String(fake.port), SC_DATA_DIR: dir }), inbox, publicDir: join(process.cwd(), "public") });
});

after(async () => {
  await server.close();
  await fake.close();
  rmSync(dir, { recursive: true, force: true });
});

test("a dry-run campaign clears people by data, screens the rest, and turns every answer into a worklist", async () => {
  const config = loadConfig({ SC_MODE: "dry-run", SC_PORT: "0", SC_FAKE_PORT: String(fake.port), SC_DATA_DIR: dir, SC_TIMEZONE: "America/New_York" });
  const client = new CalleClient({ apiKey: "dry-run", baseUrl: fake.url });
  const { people, report } = loadEnrollees(join(process.cwd(), "data", "enrollees.sample.csv"));
  const rules = loadRules();
  const state = loadState("example-state");
  const campaign: Campaign = { id: "e2e", title: "January 2027 cohort", stateId: state.id, rulesId: rules.id, source: "drill", startedAt: new Date().toISOString(), asOf: "2026-09-14", dueWithinDays: null };
  const ledger = new Ledger(join(dir, campaign.id, "ledger.jsonl"));
  server.setLedger(ledger);
  const summary = await new Orchestrator({ config, client, ledger, inbox, campaign, rules, state, people, registryReport: report, webhookUrl: `${server.url}/calle/webhook`, waveSize: 4, parallelWaves: 2, pollIntervalMs: 30, retryDelayMs: 0 }).run();

  assert.deepEqual(summary.outcomes, { cleared_by_data: 2, likely_exempt: 3, likely_meets: 1, at_risk: 1, needs_review: 2, declined: 1, opted_out: 1, identity_unconfirmed: 1, unreachable: 1, unverified: 0, dial_unknown: 0, not_attempted: 0, pending: 0 });
  const s = ledger.projection.states;
  assert.deepEqual(s.get("e001")?.exemptions, ["caregiver_disabled"]);
  assert.deepEqual(s.get("e003")?.exemptions, ["pregnant_postpartum"]);
  assert.deepEqual(s.get("e004")?.exemptions, ["medically_frail"]);
  assert.equal(s.get("e006")?.outcome, "needs_review", "a condition without a daily-activity limit is not medical frailty");
  assert.equal(s.get("e011")?.correctionNeeded, true, "the agent overclaimed, so a person must correct it");
  assert.equal(s.get("e009")?.attempts, 0, "cleared by state data: never called");
  assert.equal(s.get("e010")?.attempts, 0);
  assert.equal(s.get("e007")?.attempts, 2, "not reached: redialled once");
  assert.equal(s.get("e013")?.attempts, 2, "identity not confirmed: redialled once");
  assert.equal(summary.calls, 13);
  assert.equal(summary.awareNo, 5);
  assert.equal(summary.awareYes, 3);

  const work = [...ledger.projection.work.values()];
  const kinds = (id: string): string[] => work.filter((w) => w.personId === id).map((w) => w.kind).sort();
  assert.deepEqual(kinds("e001"), ["exemption_packet", "navigator_callback"]);
  assert.deepEqual(kinds("e003"), ["exemption_packet"]);
  assert.deepEqual(kinds("e004"), ["exemption_packet", "navigator_callback"]);
  assert.deepEqual(kinds("e002"), ["report_hours"]);
  assert.deepEqual(kinds("e005"), ["navigator_callback"]);
  assert.deepEqual(kinds("e006"), ["navigator_callback"]);
  assert.deepEqual(kinds("e011"), ["correction_call", "navigator_callback"]);
  assert.deepEqual(kinds("e007"), ["mail_letter"]);
  assert.deepEqual(kinds("e013"), ["mail_letter"]);
  assert.deepEqual(kinds("e012"), ["suppression"]);
  assert.deepEqual(kinds("e008"), []);
  assert.deepEqual(kinds("e009"), []);
  assert.equal(work.length, 13);
  assert.equal(work.filter((w) => w.needsHumanReview).length, 4, "three exemption packets and one correction call wait for a caseworker");
  assert.ok(work.find((w) => w.personId === "e005")?.highPriority, "at risk is high priority");
  assert.equal(work.find((w) => w.personId === "e001" && w.kind === "navigator_callback")?.preferredCallback, "Tuesday morning");

  assert.ok(s.get("e001")?.evidence.some((q) => q.includes("mi mamá")), "a Spanish speaker is quoted in Spanish");

  const requests = fake.requests();
  assert.equal(requests.length, 13);
  assert.ok(requests.every((r) => r.metadata["person_id"] !== "e009" && r.metadata["person_id"] !== "e010"));
  for (const r of requests) {
    assert.ok(r.task.includes("Do not mention Medicaid, coverage details or any rule until"));
    assert.ok(r.task.includes("Never say they are exempt"));
    assert.ok(!/\+1415\d{7}/.test(r.task));
  }
  const keys = requests.map((r) => r.idempotencyKey);
  assert.equal(new Set(keys).size, keys.length);
  const firstKey = keys[0] ?? "missing";
  const replay = await client.calls.create({ task: "replay", recipients: [{ phones: ["+14155550301"] }] }, { idempotencyKey: firstKey });
  assert.equal(replay.id, [...ledger.projection.calls.values()].find((c) => c.idempotencyKey === firstKey)?.callId, "the same key returns the same call, never a second dial");
  assert.equal(fake.requests().length, 13);

  assert.ok(ledger.projection.timeline.some((t) => t.message.includes("Webhook call.completed received")));

  const markdown = buildReport(ledger.projection);
  assert.ok(markdown.includes("| Called | 11 |"));
  assert.ok(markdown.includes("| Screened by phone | 7 |"));
  assert.ok(markdown.includes("| Had not heard of the rule before the call | 5 of 8 who answered (63%) |"));
  assert.ok(markdown.includes("| May qualify for an exemption | 3 |"));
  assert.ok(markdown.includes("## Corrections"));
  assert.ok(!/\+1415\d{7}/.test(markdown), "the report masks every phone number");
  assert.equal(buildReport(new Ledger(join(dir, campaign.id, "ledger.jsonl")).projection), markdown, "the report is reproducible from the ledger alone");

  const publicState = toPublicState(ledger.projection, "dry-run") as { kpis: { awareNo: number; likelyExempt: number }; people: { maskedPhone: string }[] };
  assert.equal(publicState.kpis.awareNo, 5);
  assert.ok(publicState.people.every((p) => p.maskedPhone.includes("*")));
  const response = await fetch(`${server.url}/api/state`);
  assert.equal(((await response.json()) as { kpis: { likelyExempt: number } }).kpis.likelyExempt, 3);
});

test("the webhook receiver rejects a mismatched CALL-E-Event-Id and de-duplicates", async () => {
  const post = (headerId: string, bodyId: string): Promise<Response> =>
    fetch(`${server.url}/calle/webhook`, { method: "POST", headers: { "content-type": "application/json", "CALL-E-Event-Id": headerId }, body: JSON.stringify({ id: bodyId, type: "call.completed", data: { id: "call_x" } }) });
  assert.equal((await post("evt_other", "evt_1")).status, 400);
  assert.equal((await post("evt_dup", "evt_dup")).status, 200);
  assert.deepEqual(await (await post("evt_dup", "evt_dup")).json(), { received: true, duplicate: true });
});

test("live campaigns can never be started from the dashboard", async () => {
  const live = await startServer({ config: loadConfig({ SC_MODE: "live", CALLE_API_KEY: "iams_live_test", SC_PORT: "0" }), inbox: new CallInbox(), publicDir: join(process.cwd(), "public"), startDrill: async () => ({ campaignId: "never" }) });
  try {
    const response = await fetch(`${live.url}/api/run`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(response.status, 403);
  } finally {
    await live.close();
  }
});
