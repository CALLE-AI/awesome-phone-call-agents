import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { DryRunPlacer, LivePlacer } from "../src/calle.js";
import { loadRollCallInput } from "../src/intake.js";
import { Ledger } from "../src/ledger.js";
import { renderReport } from "../src/report.js";
import { runRollCall } from "../src/run.js";
import { FakeCalleStore, fakeFetch, loadFixture } from "../fake/calle-fake.js";

const root = resolve(import.meta.dirname, "..");
const NOW = () => new Date("2026-09-14T13:10:00Z"); // 09:10 New York

function fakePlacer(store: FakeCalleStore) {
  return new LivePlacer({ apiKey: "fake", baseUrl: "http://fake.local", fetch: fakeFetch(store), intervalMs: 1 });
}

test("dry run walks every guardian, places no call, and reports what would happen", async () => {
  const input = loadRollCallInput(join(root, "examples/absences.example.json"));
  const placer = new DryRunPlacer();
  const report = await runRollCall(input, { placer, ledger: new Ledger(null), now: NOW });
  assert.equal(report.mode, "dry-run");
  assert.equal(report.totals.safeguarding_alert, 0);
  // consent-less and do-not-call guardians are never even "dry-dialled"
  const femi = report.students.find((s) => s.firstName === "Femi")!;
  assert.equal(femi.disposition, "not_called");
  assert.ok(femi.attempts.every((a) => a.skippedReason));
  // every dry-run request carries the strict schema and an idempotency key
  assert.ok(placer.requests.length > 0);
  for (const r of placer.requests) {
    assert.match(r.idempotencyKey, /^rollcall_2026-09-14_S-\d+_g\d$/);
    assert.equal((r.resultSchema as any).additionalProperties, false);
    assert.match(r.task, /automated assistant calling on behalf of Riverside Primary School/);
    assert.doesNotMatch(r.task, /S-\d{4}/, "student id must never be in the task text");
  }
});

test("scripted morning: alert, cascade to second guardian, vague call to review, unreached after cascade limit", async () => {
  const input = loadRollCallInput(join(root, "examples/absences.example.json"));
  const store = new FakeCalleStore(loadFixture(join(root, "fixtures/outcomes.json")), { pollsUntilTerminal: 2 });
  const report = await runRollCall(input, { placer: fakePlacer(store), ledger: new Ledger(null), now: NOW });

  const by = Object.fromEntries(report.students.map((s) => [s.firstName, s]));
  assert.equal(by.Amara.disposition, "accounted_for");
  assert.equal(by.Ben.disposition, "safeguarding_alert");
  assert.equal(by.Ben.attempts.length, 1, "cascade stops once a guardian is reached");
  assert.equal(by.Chloe.disposition, "accounted_for");
  assert.equal(by.Chloe.attempts.filter((a) => a.outcome).length, 2, "voicemail cascades to the second guardian");
  assert.match(by.Chloe.because, /guardian 2/);
  assert.equal(by.Dev.disposition, "needs_human_review", "extraction said yes but no turn supports it");
  assert.equal(by.Elif.disposition, "unreached");
  assert.equal(by.Elif.attempts.filter((a) => a.outcome).length, 2, "maxGuardiansPerStudent caps the cascade");
  assert.match(by.Elif.attempts[2].skippedReason ?? "", /cascade limit/);
  assert.equal(by.Femi.disposition, "not_called");

  assert.equal(report.students[0].disposition, "safeguarding_alert", "alerts sort first");
  const text = renderReport(report);
  assert.doesNotMatch(text, /\+1555010010\d/, "no full phone number in the report");
  assert.match(text, /SAFEGUARDING ALERT: 1/);

  const posts = store.requests.filter((r) => r.method === "POST");
  assert.equal(posts.length, 7);
  for (const p of posts) {
    assert.ok(p.headers["idempotency-key"]?.startsWith("rollcall_"));
    assert.equal((p.body as any).recipients.length, 1, "one recipient per task keeps the cascade sequential");
  }
});

test("ledger prevents a re-run from dialling anybody twice on the same day", async () => {
  const input = loadRollCallInput(join(root, "examples/absences.example.json"));
  const dir = mkdtempSync(join(tmpdir(), "rollcall-"));
  const ledgerPath = join(dir, "ledger.jsonl");
  const fixture = loadFixture(join(root, "fixtures/outcomes.json"));

  const first = new FakeCalleStore(fixture);
  await runRollCall(input, { placer: fakePlacer(first), ledger: new Ledger(ledgerPath), now: NOW });
  const lines = readFileSync(ledgerPath, "utf8").trim().split("\n");
  assert.equal(lines.length, 7);

  const second = new FakeCalleStore(fixture);
  const rerun = await runRollCall(input, { placer: fakePlacer(second), ledger: new Ledger(ledgerPath), now: NOW });
  assert.equal(second.requests.filter((r) => r.method === "POST").length, 0, "no new call tasks on re-run");
  assert.ok(rerun.students.every((s) => s.attempts.every((a) => a.skippedReason || a.outcome === null)));
  assert.match(rerun.students.find((s) => s.firstName === "Ben")!.attempts[0].skippedReason ?? "", /already dialled/);
});

test("approval hook can refuse a call and the refusal is reported", async () => {
  const input = loadRollCallInput(join(root, "examples/absences.example.json"));
  const store = new FakeCalleStore(loadFixture(join(root, "fixtures/outcomes.json")));
  const report = await runRollCall(input, {
    placer: fakePlacer(store),
    ledger: new Ledger(null),
    now: NOW,
    approve: (r) => r.phone !== "+15550100102",
  });
  const ben = report.students.find((s) => s.firstName === "Ben")!;
  assert.match(ben.attempts[0].skippedReason ?? "", /refused at approval/);
  assert.ok(ben.attempts[1].outcome, "cascade moved on to the second guardian");
});

test("fake CALL-E enforces bearer auth and idempotency like the real one", () => {
  const store = new FakeCalleStore({});
  assert.equal(store.handle("POST", "/v1/calls", {}, JSON.stringify({ task: "x" })).status, 401);
  const h = { authorization: "Bearer k", "idempotency-key": "same" };
  const body = JSON.stringify({ task: "x", recipients: [{ phones: ["+15550100101"] }] });
  const a = store.handle("POST", "/v1/calls", h, body);
  const b = store.handle("POST", "/v1/calls", h, body);
  assert.equal(a.status, 201);
  assert.equal(b.status, 200);
  assert.equal((a.body as any).id, (b.body as any).id);
  const c = store.handle("POST", "/v1/calls", h, JSON.stringify({ task: "y", recipients: [{ phones: ["+15550100101"] }] }));
  assert.equal(c.status, 409);
});
