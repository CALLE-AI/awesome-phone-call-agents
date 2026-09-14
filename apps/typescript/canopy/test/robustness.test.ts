// Failure semantics against the fake CALL-E server: rejected creates, timeouts, resume, per-person tasks.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CalleClient } from "@call-e/calle";
import { loadConfig, type Config } from "../src/config.js";
import { startFakeCalleServer, type FakeServerOptions } from "../src/fake-calle-server.js";
import { Ledger } from "../src/ledger.js";
import { CallInbox, Orchestrator, type RunOptions } from "../src/orchestrator.js";
import { loadPlaybook } from "../src/playbooks.js";
import { loadRegistry } from "../src/registry.js";
import { buildReport } from "../src/report.js";
import type { HazardEvent } from "../src/types.js";

const REGISTRY = join(process.cwd(), "data", "registry.sample.csv");

async function harness(fakeOptions: FakeServerOptions, overrides: Partial<RunOptions> = {}, env: Record<string, string> = {}) {
  const fake = await startFakeCalleServer({ port: 0, queueDelayMs: 30, perRecipientMs: 20, ...fakeOptions });
  const dir = mkdtempSync(join(tmpdir(), "canopy-robust-"));
  const config: Config = loadConfig({ CANOPY_MODE: "dry-run", CANOPY_FAKE_PORT: String(fake.port), CANOPY_DATA_DIR: dir, CANOPY_ORG: "Test County", CANOPY_EMERGENCY_NUMBER: "911", ...env });
  const client = new CalleClient({ apiKey: "dry-run", baseUrl: fake.url });
  const { people, report } = loadRegistry(REGISTRY);
  const event: HazardEvent = { id: "heat-robust", hazard: "heat", area: "Test", severity: "Extreme", headline: "Extreme Heat Warning", source: "drill", startedAt: new Date().toISOString(), org: config.org, emergencyNumber: "911", resource: null };
  const ledgerPath = join(dir, event.id, "ledger.jsonl");
  const make = (extra: Partial<RunOptions> = {}): Orchestrator =>
    new Orchestrator({
      config,
      client,
      ledger: new Ledger(ledgerPath),
      inbox: new CallInbox(),
      event,
      playbook: loadPlaybook("heat"),
      people,
      registryReport: report,
      webhookUrl: null,
      waveSize: 4,
      parallelWaves: 2,
      pollIntervalMs: 20,
      retryDelayMs: 0,
      createRetryBaseMs: 5,
      ...overrides,
      ...extra,
    });
  return { fake, dir, make, ledgerPath, config, cleanup: async () => { await fake.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("a transient 429 on create is retried and the wave proceeds normally", async () => {
  const h = await harness({ createFailures: { count: 2, status: 429, code: "rate_limit_exceeded" } });
  try {
    const summary = await h.make().run();
    assert.equal(summary.notAttempted, 0);
    assert.equal(summary.outcomes.red, 2);
    const ledger = new Ledger(h.ledgerPath);
    assert.ok(ledger.projection.timeline.some((t) => t.message.includes("retry 1/4")));
    assert.equal(ledger.projection.failedWaves.length, 0);
  } finally {
    await h.cleanup();
  }
});

test("a create CALL-E keeps refusing marks people not attempted and never phones their contacts", async () => {
  const h = await harness({ createFailures: { count: 100, status: 503, code: "provider_unavailable" } }, { createRetries: 1 });
  try {
    const summary = await h.make().run();
    assert.equal(summary.notAttempted, 8);
    assert.equal(summary.escalationCalls, 0, "nobody is escalated for a call that never happened");
    assert.equal(summary.callsPlaced, 0);
    const ledger = new Ledger(h.ledgerPath);
    const kinds = new Set([...ledger.projection.dispatches.values()].map((t) => t.kind));
    assert.deepEqual([...kinds], ["not_attempted"]);
    assert.equal(ledger.projection.failedWaves.length, 3);
    for (const state of ledger.projection.states.values()) {
      assert.equal(state.nextAction?.type, "operator-review");
    }
    assert.ok(buildReport(ledger.projection).includes("Status: **incomplete**"));
  } finally {
    await h.cleanup();
  }
});

test("a rejected request that is not transient is not retried", async () => {
  const h = await harness({ createFailures: { count: 1, status: 422, code: "invalid_phone" } }, { createRetries: 3 });
  try {
    await h.make().run();
    const ledger = new Ledger(h.ledgerPath);
    assert.ok(!ledger.projection.timeline.some((t) => t.message.includes("retry 1/3")));
    assert.equal(ledger.projection.failedWaves.length, 1);
  } finally {
    await h.cleanup();
  }
});

test("resume re-places refused waves with the same idempotency keys and finishes the cascade", async () => {
  const h = await harness({ createFailures: { count: 3, status: 503, code: "provider_unavailable" } }, { createRetries: 0 });
  try {
    const first = await h.make().run();
    assert.equal(first.notAttempted, 8);
    const before = new Ledger(h.ledgerPath).projection.failedWaves.map((f) => `${f.wave.index}:${f.wave.attempt}`);
    assert.deepEqual(before, ["1:1", "2:1", "3:1"]);

    const resumed = await h.make().resume();
    assert.equal(resumed.notAttempted, 0);
    assert.deepEqual(resumed.outcomes, { green: 3, yellow: 1, red: 2, declined: 0, unreachable: 1, unverified: 1, not_attempted: 0, pending: 0 });
    assert.equal(resumed.escalationCalls, 3);
    const ledger = new Ledger(h.ledgerPath);
    assert.equal(ledger.projection.failedWaves.length, 0);
    const keys = [...ledger.projection.calls.values()].filter((c) => c.kind === "wave").map((c) => c.idempotencyKey);
    assert.ok(keys.includes("canopy:heat-robust:wave1:attempt1"), "the original wave key is reused, so a call CALL-E had in fact accepted would be returned, not duplicated");
    assert.equal(new Set(keys).size, keys.length);
    // not_attempted tickets remain as history, but no person is still marked not attempted
    assert.ok([...ledger.projection.states.values()].every((s) => s.outcome !== "not_attempted"));
  } finally {
    await h.cleanup();
  }
});

test("a call that does not finish in time is left pending, never guessed, and resume settles it", async () => {
  const h = await harness({ queueDelayMs: 300, perRecipientMs: 200 });
  try {
    const paused = await h.make({ callTimeoutMs: 120, waveSize: 8, parallelWaves: 1 }).run();
    assert.equal(paused.pending, 2, "two waves (priority 1 and priority 2) were placed and both are still in flight");
    assert.equal(paused.outcomes.pending, 8);
    assert.equal(paused.escalationCalls, 0);
    const mid = new Ledger(h.ledgerPath);
    assert.ok([...mid.projection.states.values()].every((s) => s.nextAction?.type === "await-result"));
    assert.ok(buildReport(mid.projection).includes("Awaiting a result"));

    const settled = await h.make({ callTimeoutMs: 10000, waveSize: 8 }).resume();
    assert.equal(settled.pending, 0);
    assert.deepEqual(settled.outcomes, { green: 3, yellow: 1, red: 2, declined: 0, unreachable: 1, unverified: 1, not_attempted: 0, pending: 0 });
    assert.equal(settled.escalationCalls, 3);
  } finally {
    await h.cleanup();
  }
});

test("running the cascade twice never duplicates tickets or escalation calls", async () => {
  const h = await harness({});
  try {
    const first = await h.make().run();
    const again = await h.make().resume();
    assert.equal(again.dispatches, first.dispatches);
    assert.equal(again.escalationCalls, first.escalationCalls);
    assert.equal(again.callsPlaced, first.callsPlaced);
  } finally {
    await h.cleanup();
  }
});

test("per-person mode places one single-recipient task per person with its own key, same verdicts", async () => {
  const h = await harness({}, {}, { CANOPY_TASK_MODE: "per-person" });
  try {
    const summary = await h.make().run();
    assert.deepEqual(summary.outcomes, { green: 3, yellow: 1, red: 2, declined: 0, unreachable: 1, unverified: 1, not_attempted: 0, pending: 0 });
    const ledger = new Ledger(h.ledgerPath);
    const waveCalls = [...ledger.projection.calls.values()].filter((c) => c.kind === "wave");
    assert.equal(waveCalls.length, 10, "8 first-pass tasks plus 2 redials");
    assert.ok(waveCalls.every((c) => c.recipients.length === 1));
    assert.ok(waveCalls.every((c) => /:p\d{3}$/.test(c.idempotencyKey)));
    assert.equal(new Set(waveCalls.map((c) => c.idempotencyKey)).size, 10);
  } finally {
    await h.cleanup();
  }
});

test("dry-run transcripts are localized for Hindi, Tamil and Spanish speakers", async () => {
  const h = await harness({});
  try {
    await h.make().run();
    const ledger = new Ledger(h.ledgerPath);
    assert.ok(ledger.projection.states.get("p003")?.evidence.some((q) => q.includes("Haan")), "Hindi speaker quoted in Hindi");
    assert.ok(ledger.projection.states.get("p001")?.evidence.some((q) => q.includes("Si") || q.includes("habla")), "Spanish speaker quoted in Spanish");
    assert.ok(ledger.projection.states.get("p007")?.evidence.some((q) => q.includes("Aamaa")), "Tamil speaker quoted in Tamil");
  } finally {
    await h.cleanup();
  }
});
