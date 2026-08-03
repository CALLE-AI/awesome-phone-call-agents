/**
 * Runner behavior, driven end-to-end through the real SDK against the fake
 * server: dry-run stays silent, live runs call once per check, unverified
 * lines are refused, the disclosure preamble is always on the wire, and one
 * failing call never takes down the rest of the run.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFakeCalle, type FakeCalle } from "../fake/calle-server.js";
import { createSdkPort } from "../src/calle.js";
import { openStore, type BaselineStore } from "../src/baseline.js";
import { runChecks, DISCLOSURE_PREAMBLE } from "../src/runner.js";
import type { Config } from "../src/config.js";

function config(): Config {
  return {
    lines: [
      { id: "main-office", phone: "+15550100", region: "US", locale: "en-US", ownership: { method: "greeting_code", code: "LC-1" } },
      { id: "second-line", phone: "+15550101", ownership: { method: "greeting_code", code: "LC-2" } },
    ],
    checks: [
      {
        id: "hours",
        line: "main-office",
        task: "Ask for Saturday hours.",
        resultSchema: { type: "object", properties: { answered: { type: "boolean" } }, required: ["answered"], additionalProperties: false },
        assert: [{ path: "answered", equals: true }],
      },
      {
        id: "greeting",
        line: "second-line",
        task: "Listen to the greeting and report the business name.",
        resultSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
        assert: [{ path: "name", contains: "acme" }],
      },
    ],
    baselineDir: "unused",
  };
}

function verify(store: BaselineStore, lineId: string, phone: string): void {
  store.recordVerification({ lineId, phone, method: "greeting_code", verifiedAt: "2026-08-02T09:00:00Z", callId: "call_v" });
}

function freshStore(): BaselineStore {
  return openStore(join(mkdtempSync(join(tmpdir(), "linecanary-runner-")), "baselines"));
}

const PASSING_SCENARIOS = [
  { phone: "+15550100", structuredResult: { answered: true }, turns: [{ speaker: "user" as const, text: "Front desk.", offsetSeconds: 4 }] },
  { phone: "+15550101", structuredResult: { name: "ACME Plumbing" }, turns: [{ speaker: "user" as const, text: "ACME.", offsetSeconds: 3 }] },
];

async function withLiveRun(
  scenarios: Parameters<typeof startFakeCalle>[0],
  run: (fake: FakeCalle, store: BaselineStore) => Promise<void>,
): Promise<void> {
  const fake = await startFakeCalle(scenarios);
  try {
    const store = freshStore();
    verify(store, "main-office", "+15550100");
    verify(store, "second-line", "+15550101");
    await run(fake, store);
  } finally {
    await fake.close();
  }
}

test("dry-run plans every check, calls nothing and writes nothing", async () => {
  const fake = await startFakeCalle(PASSING_SCENARIOS);
  try {
    const store = freshStore();
    const report = await runChecks(config(), null, store, { live: false, timeoutMs: 5_000, intervalMs: 10 });
    assert.equal(report.live, false);
    assert.equal(report.ok, true);
    assert.equal(report.runs.length, 2);
    assert.ok(report.runs.every((run) => run.skipped === "dry-run" && run.outcome === null));
    assert.equal(report.runs[0].planned.phone, "+15550100");
    assert.equal(fake.created.length, 0);
    assert.deepEqual(store.history("hours"), []);
  } finally {
    await fake.close();
  }
});

test("live run calls once per check, appends outcomes and reports ok on first run", async () => {
  await withLiveRun(PASSING_SCENARIOS, async (fake, store) => {
    const port = await createSdkPort({ apiKey: "calle_test_key", baseUrl: fake.baseUrl });
    const report = await runChecks(config(), port, store, { live: true, timeoutMs: 5_000, intervalMs: 10 });
    assert.equal(report.ok, true);
    assert.equal(fake.created.length, 2);
    assert.equal(store.history("hours").length, 1);
    assert.equal(store.history("greeting").length, 1);
    assert.deepEqual(report.regressions, []);
    const task = fake.created[0].task;
    assert.ok(task.startsWith(DISCLOSURE_PREAMBLE), "disclosure preamble must lead the task");
    assert.ok(task.includes("Ask for Saturday hours."));
    assert.ok(fake.created[0].idempotencyKey?.startsWith("linecanary:hours:"));
  });
});

test("a regression on the second run is detected and fails the report", async () => {
  await withLiveRun(PASSING_SCENARIOS, async (fake, store) => {
    const port = await createSdkPort({ apiKey: "calle_test_key", baseUrl: fake.baseUrl });
    await runChecks(config(), port, store, { live: true, timeoutMs: 5_000, intervalMs: 10 });
    fake.setScenario({ phone: "+15550100", structuredResult: { answered: false }, turns: [] });
    const report = await runChecks(config(), port, store, { live: true, timeoutMs: 5_000, intervalMs: 10 });
    assert.equal(report.ok, false);
    const kinds = report.regressions.map((entry) => entry.kind).sort();
    assert.deepEqual(kinds, ["assertion_regressed", "new_failure"]);
    assert.equal(store.history("hours").length, 2);
  });
});

test("unverified lines are skipped without any call", async () => {
  const fake = await startFakeCalle(PASSING_SCENARIOS);
  try {
    const store = freshStore();
    verify(store, "main-office", "+15550100"); // second-line stays unverified
    const port = await createSdkPort({ apiKey: "calle_test_key", baseUrl: fake.baseUrl });
    const report = await runChecks(config(), port, store, { live: true, timeoutMs: 5_000, intervalMs: 10 });
    assert.equal(fake.created.length, 1);
    const skipped = report.runs.find((run) => run.planned.checkId === "greeting");
    assert.equal(skipped?.skipped, "unverified-line");
    assert.equal(skipped?.outcome, null);
    // A refused call is not a monitoring result; the report stays ok.
    assert.equal(report.ok, true);
  } finally {
    await fake.close();
  }
});

test("a verification recorded for a different phone does not cover the line", async () => {
  const fake = await startFakeCalle(PASSING_SCENARIOS);
  try {
    const store = freshStore();
    verify(store, "main-office", "+15559999"); // stale: config phone changed since
    verify(store, "second-line", "+15550101");
    const port = await createSdkPort({ apiKey: "calle_test_key", baseUrl: fake.baseUrl });
    const report = await runChecks(config(), port, store, { live: true, timeoutMs: 5_000, intervalMs: 10 });
    const skipped = report.runs.find((run) => run.planned.checkId === "hours");
    assert.equal(skipped?.skipped, "unverified-line");
    assert.equal(fake.created.length, 1);
    assert.equal(report.ok, true);
  } finally {
    await fake.close();
  }
});

test("an API error on one check is captured and the rest still run", async () => {
  await withLiveRun(
    [
      { phone: "+15550100", apiError: { status: 500, code: "internal_error" } },
      PASSING_SCENARIOS[1],
    ],
    async (fake, store) => {
      const port = await createSdkPort({ apiKey: "calle_test_key", baseUrl: fake.baseUrl });
      const report = await runChecks(config(), port, store, { live: true, timeoutMs: 5_000, intervalMs: 10 });
      assert.equal(report.ok, false);
      const errored = report.runs.find((run) => run.planned.checkId === "hours");
      assert.match(errored?.error ?? "", /internal_error/);
      assert.equal(errored?.outcome, null);
      const succeeded = report.runs.find((run) => run.planned.checkId === "greeting");
      assert.equal(succeeded?.outcome?.status, "pass");
      assert.equal(store.history("greeting").length, 1);
      assert.deepEqual(store.history("hours"), []);
    },
  );
});

test("--only filters checks and marks the rest filtered", async () => {
  await withLiveRun(PASSING_SCENARIOS, async (fake, store) => {
    const port = await createSdkPort({ apiKey: "calle_test_key", baseUrl: fake.baseUrl });
    const report = await runChecks(config(), port, store, { live: true, only: ["greeting"], timeoutMs: 5_000, intervalMs: 10 });
    assert.equal(fake.created.length, 1);
    assert.equal(report.runs.find((run) => run.planned.checkId === "hours")?.skipped, "filtered");
    assert.equal(report.runs.find((run) => run.planned.checkId === "greeting")?.outcome?.status, "pass");
  });
});
