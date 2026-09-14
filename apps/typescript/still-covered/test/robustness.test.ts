// Failure semantics against the fake CALL-E server: refused creates, outages, timeouts, resume,
// follow-up limits and opt-outs.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CalleClient } from "@call-e/calle";
import { loadConfig } from "../src/config.js";
import { startFakeCalleServer, type FakeServerOptions } from "../src/fake-calle-server.js";
import { Ledger } from "../src/ledger.js";
import { CallInbox, Orchestrator, type RunOptions } from "../src/orchestrator.js";
import { loadEnrollees } from "../src/registry.js";
import { loadRules, loadState } from "../src/rules.js";
import type { Campaign } from "../src/types.js";

const NORMAL = { cleared_by_data: 2, likely_exempt: 3, likely_meets: 1, at_risk: 1, needs_review: 2, declined: 1, opted_out: 1, identity_unconfirmed: 1, unreachable: 1, unverified: 0, dial_unknown: 0, not_attempted: 0, pending: 0 };

async function harness(fakeOptions: FakeServerOptions, overrides: Partial<RunOptions> = {}) {
  const fake = await startFakeCalleServer({ port: 0, queueDelayMs: 30, perRecipientMs: 20, ...fakeOptions });
  const dir = mkdtempSync(join(tmpdir(), "sc-robust-"));
  const config = loadConfig({ SC_MODE: "dry-run", SC_FAKE_PORT: String(fake.port), SC_DATA_DIR: dir });
  const client = new CalleClient({ apiKey: "dry-run", baseUrl: fake.url });
  const { people, report } = loadEnrollees(join(process.cwd(), "data", "enrollees.sample.csv"));
  const rules = loadRules();
  const state = loadState("example-state");
  const campaign: Campaign = { id: "robust", title: "Robustness", stateId: state.id, rulesId: rules.id, source: "drill", startedAt: new Date().toISOString(), asOf: "2026-09-14", dueWithinDays: null };
  const ledgerPath = join(dir, campaign.id, "ledger.jsonl");
  const make = (extra: Partial<RunOptions> = {}): Orchestrator =>
    new Orchestrator({ config, client, ledger: new Ledger(ledgerPath), inbox: new CallInbox(), campaign, rules, state, people, registryReport: report, webhookUrl: null, waveSize: 4, parallelWaves: 2, pollIntervalMs: 20, retryDelayMs: 0, createRetryBaseMs: 5, ...overrides, ...extra });
  return { fake, make, ledgerPath, cleanup: async () => { await fake.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("a transient 429 on create is retried and the campaign finishes normally", async () => {
  const h = await harness({ createFailures: { count: 2, status: 429, code: "rate_limit_exceeded" } });
  try {
    const s = await h.make().run();
    assert.deepEqual(s.outcomes, NORMAL);
    assert.ok(new Ledger(h.ledgerPath).projection.timeline.some((t) => t.message.includes("retry 1/4")));
  } finally {
    await h.cleanup();
  }
});

test("a 503 outage is recorded as unknown, not as 'nobody was dialled', and is never auto-redialled", async () => {
  // A 5xx does not say whether the request arrived. Claiming not_attempted there would assert
  // something the system cannot know, and a redial could ring somebody who has already been rung.
  const h = await harness({ createFailures: { count: 10_000, status: 503, code: "provider_unavailable" } }, { createRetries: 1 });
  try {
    const s = await h.make().run();
    assert.equal(s.outcomes.dial_unknown, 11, "unknown, not not_attempted");
    assert.equal(s.outcomes.not_attempted, 0, "the system never claims nobody was dialled after an ambiguous failure");
    assert.equal(s.outcomes.cleared_by_data, 2);
    assert.equal(s.calls, 0);

    const ledger = new Ledger(h.ledgerPath);
    assert.ok(!ledger.projection.timeline.some((t) => t.message.includes("retry 1/1")), "an ambiguous submission is not re-sent automatically");

    const work = [...ledger.projection.work.values()];
    assert.deepEqual([...new Set(work.map((w) => w.kind))], ["operator_review"]);
    assert.ok(work.every((w) => w.needsHumanReview), "every one waits on a person");

    for (const person of ledger.projection.states.values()) {
      if (person.outcome === "dial_unknown") {
        assert.ok(person.reasons.some((r) => r.includes("sc:robust:")), "the reason names the idempotency key to reconcile");
        assert.notEqual(person.nextAction?.type, "retry", "never redial what may already have rung");
      }
    }
  } finally {
    await h.cleanup();
  }
});

test("a request CALL-E refuses outright is still 'not attempted': that one really is a fact", async () => {
  const h = await harness({ createFailures: { count: 10_000, status: 422, code: "invalid_request" } }, { createRetries: 1 });
  try {
    const s = await h.make().run();
    assert.equal(s.outcomes.not_attempted, 11, "a validation refusal happens before anything is dialled");
    assert.equal(s.outcomes.dial_unknown, 0);
  } finally {
    await h.cleanup();
  }
});

test("an invalid request is not retried", async () => {
  const h = await harness({ createFailures: { count: 1, status: 422, code: "invalid_phone" } }, { createRetries: 3 });
  try {
    await h.make().run();
    const ledger = new Ledger(h.ledgerPath);
    assert.ok(!ledger.projection.timeline.some((t) => t.message.includes("retry 1/3")));
    assert.equal(ledger.projection.failedWaves.reduce((n, f) => n + f.personIds.length, 0), 1);
  } finally {
    await h.cleanup();
  }
});

test("resume re-places refused tasks with the same keys and reaches the same end state", async () => {
  const h = await harness({ createFailures: { count: 3, status: 503, code: "provider_unavailable" } }, { createRetries: 0 });
  try {
    const first = await h.make().run();
    assert.equal(first.dialUnknown, 3, "a 503 leaves it unknown whether these three were dialled");
    const refused = new Ledger(h.ledgerPath).projection.failedWaves.flatMap((f) => f.personIds);
    assert.equal(refused.length, 3);
    // Resume is the reconciliation: the same idempotency key either settles the call CALL-E already
    // has or creates the one it never got, so the unknown resolves without anybody being dialled twice.
    const resumed = await h.make().resume();
    assert.deepEqual(resumed.outcomes, NORMAL);
    assert.equal(new Ledger(h.ledgerPath).projection.failedWaves.length, 0);
    const keys = h.fake.requests().map((r) => r.idempotencyKey);
    for (const id of refused) {
      assert.ok(keys.includes(`sc:robust:${id}:attempt1`), `${id} was re-placed with its original key`);
    }
    assert.equal(new Set(keys).size, keys.length);
  } finally {
    await h.cleanup();
  }
});

test("a call that has not finished is left awaiting, never guessed, and resume settles it", async () => {
  const h = await harness({ queueDelayMs: 300, perRecipientMs: 200 });
  try {
    const paused = await h.make({ callTimeoutMs: 100, parallelWaves: 5 }).run();
    assert.equal(paused.outcomes.pending, 11);
    assert.equal(paused.pending, 11);
    assert.equal(paused.workItems, 0, "nothing is inferred about people whose call has not finished");
    const settled = await h.make({ callTimeoutMs: 10_000 }).resume();
    assert.deepEqual(settled.outcomes, NORMAL);
    assert.equal(settled.pending, 0);
  } finally {
    await h.cleanup();
  }
});

test("resuming a finished campaign places no new call and creates no duplicate work", async () => {
  const h = await harness({});
  try {
    const first = await h.make().run();
    const before = h.fake.requests().length;
    const again = await h.make().resume();
    assert.equal(h.fake.requests().length, before);
    assert.deepEqual(again.outcomes, first.outcomes);
    assert.equal(again.workItems, first.workItems);
  } finally {
    await h.cleanup();
  }
});

test("follow-up calls back someone who asked for a better time, at most three calls in total, then a letter", async () => {
  const h = await harness({});
  try {
    await h.make().run();
    await h.make().followUp(["e008"]);
    let ledger = new Ledger(h.ledgerPath);
    assert.equal(ledger.projection.states.get("e008")?.attempts, 2);
    assert.equal(ledger.projection.states.get("e008")?.nextAction?.type, "follow-up");
    await h.make().followUp(["e008"]);
    ledger = new Ledger(h.ledgerPath);
    assert.equal(ledger.projection.states.get("e008")?.attempts, 3);
    assert.equal(ledger.projection.states.get("e008")?.nextAction?.type, "mail");
    assert.ok([...ledger.projection.work.values()].some((w) => w.personId === "e008" && w.kind === "mail_letter"));
    const before = h.fake.requests().length;
    await h.make().followUp(["e008"]);
    assert.equal(h.fake.requests().length, before, "the hard cap of three calls holds");
  } finally {
    await h.cleanup();
  }
});

test("someone who asked not to be called again is never called again", async () => {
  const h = await harness({});
  try {
    await h.make().run();
    const before = h.fake.requests().length;
    await h.make().followUp(["e012"]);
    assert.equal(h.fake.requests().length, before);
  } finally {
    await h.cleanup();
  }
});
