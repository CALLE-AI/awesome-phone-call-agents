/**
 * Ledger and replay. Replay is the part that matters: it recomputes the feasible
 * set, the chosen slot and the outcome from the recorded answers, so a ledger
 * that says Thursday when the answers do not intersect on Thursday fails.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSdkPort } from "../src/calle.js";
import { runCoordination } from "../src/coordinate.js";
import { canonicalJson, acquireLedgerLock, digestOf, LedgerLockError, readEntries, replay, requestDigest } from "../src/ledger.js";
import type { LedgerEntry } from "../src/types.js";
import { startFakeCalle, type FakeScript } from "../fake/calle-server.js";
import { coordinationRequest, PLUMBER, SUPER, TENANT } from "./fixtures.js";

function gather(phone: string, options: number[], spoken: string): FakeScript {
  return {
    phone,
    phase: "gather",
    userLines: ["Hello?", spoken],
    structuredResult: { available_options: options, none_work: "no", notes: "" },
  };
}

function confirmYes(phone: string): FakeScript {
  return {
    phone,
    phase: "confirm",
    userLines: ["Speaking.", "Confirm, see you then."],
    structuredResult: { answer: "confirm", notes: "" },
  };
}

async function confirmedLedger(): Promise<{ path: string; entries: LedgerEntry[] }> {
  const fake = await startFakeCalle([
    gather(PLUMBER, [1, 2], "Option one and option two work for me."),
    gather(TENANT, [2], "Option two works."),
    gather(SUPER, [2], "Option two works."),
    confirmYes(PLUMBER),
    confirmYes(TENANT),
    confirmYes(SUPER),
  ]);
  const port = await createSdkPort({ apiKey: "calle_test_key", baseUrl: fake.baseUrl });
  const path = join(mkdtempSync(join(tmpdir(), "mps-ledger-")), "ledger.jsonl");
  await runCoordination({ request: coordinationRequest(), port, ledgerPath: path, pollIntervalMs: 5 });
  await fake.close();
  return { path, entries: readEntries(path) };
}

function rewrite(path: string, entries: LedgerEntry[]): void {
  writeFileSync(path, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
}

test("canonical json ignores key order and digests are stable", () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] }), canonicalJson({ a: [2, { c: 3, d: 4 }], b: 1 }));
  assert.match(digestOf({ a: 1 }), /^sha256:[0-9a-f]{64}$/);
  assert.equal(requestDigest(coordinationRequest()), requestDigest(coordinationRequest()));
});

test("a real run replays cleanly and keeps the codes out of the file", async () => {
  const { path, entries } = await confirmedLedger();
  const verification = replay(entries);
  assert.equal(verification.ok, true, JSON.stringify(verification.issues));
  assert.equal(verification.outcome, "verbally_confirmed");
  const text = readFileSync(path, "utf8");
  assert.equal(text.includes("+14155550101"), false, "full numbers must not reach the ledger");
  assert.match(text, /\+14\*+01/);
  assert.equal(text.includes("booked"), false, "the ledger never claims a booking exists");
});

test("one writer per ledger and the lock is taken before any call", () => {
  const path = join(mkdtempSync(join(tmpdir(), "mps-lock-")), "ledger.jsonl");
  const lock = acquireLedgerLock(path);
  assert.throws(
    () => acquireLedgerLock(path),
    (error: unknown) => {
      assert.ok(error instanceof LedgerLockError);
      assert.match(error.message, /Another run holds/);
      assert.match(error.message, /pid \d+/);
      return true;
    },
  );
  lock.release();
  acquireLedgerLock(path).release();
});

test("a run refuses a ledger another run holds, before it dials anybody", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "mps-lock-")), "ledger.jsonl");
  const lock = acquireLedgerLock(path);
  const fake = await startFakeCalle([gather(PLUMBER, [2], "Option two works.")]);
  const port = await createSdkPort({ apiKey: "calle_test_key", baseUrl: fake.baseUrl });
  await assert.rejects(
    () => runCoordination({ request: coordinationRequest(), port, ledgerPath: path, pollIntervalMs: 5 }),
    LedgerLockError,
  );
  assert.equal(fake.created.length, 0, "not one call while another run holds the ledger");
  lock.release();
  await fake.close();
});

test("widening a recorded feasible set is caught", async () => {
  const { path, entries } = await confirmedLedger();
  const tampered = entries.map((entry) =>
    entry.kind === "gather" && entry.result.party_id === "tenant"
      ? { ...entry, feasible_after: ["thu-10", "thu-14"] }
      : entry,
  );
  rewrite(path, tampered);
  const verification = replay(readEntries(path));
  assert.equal(verification.ok, false);
  assert.ok(
    verification.issues.some((issue) => issue.problem.includes("does not follow from tenant's recorded answer")),
    JSON.stringify(verification.issues),
  );
});

test("booking a slot the answers do not support is caught", async () => {
  const { path, entries } = await confirmedLedger();
  const tampered = entries.map((entry) =>
    entry.kind === "slot_chosen" ? { ...entry, slot_id: "fri-09" } : entry,
  );
  rewrite(path, tampered);
  const verification = replay(readEntries(path));
  assert.equal(verification.ok, false);
  assert.ok(verification.issues.some((issue) => issue.problem.includes("is not the earliest slot")));
});

test("a confirmed outcome with a missing confirmation is caught", async () => {
  const { path, entries } = await confirmedLedger();
  const tampered = entries.filter(
    (entry) => !(entry.kind === "commit" && entry.result.party_id === "superintendent"),
  );
  rewrite(path, tampered);
  const verification = replay(readEntries(path));
  assert.equal(verification.ok, false);
  assert.ok(verification.issues.some((issue) => issue.problem.includes("superintendent never confirmed")));
});

test("a failed run that never released a party who said yes is caught", async () => {
  const fake = await startFakeCalle([
    gather(PLUMBER, [2], "Option two works."),
    gather(TENANT, [2], "Option two works."),
    gather(SUPER, [2], "Option two works."),
    confirmYes(PLUMBER),
    {
      phone: TENANT,
      phase: "confirm",
      userLines: ["Speaking.", "Sorry, I cannot make that."],
      structuredResult: { answer: "decline", notes: "" },
    },
    { phone: PLUMBER, phase: "release", userLines: ["Hello?", "Okay, thanks."], structuredResult: { acknowledged: "yes", notes: "" } },
  ]);
  const port = await createSdkPort({ apiKey: "calle_test_key", baseUrl: fake.baseUrl });
  const path = join(mkdtempSync(join(tmpdir(), "mps-ledger-")), "ledger.jsonl");
  const result = await runCoordination({ request: coordinationRequest(), port, ledgerPath: path, pollIntervalMs: 5 });
  await fake.close();
  assert.equal(result.outcome, "not_confirmed");
  assert.equal(replay(readEntries(path)).ok, true);

  const entries = readEntries(path).filter((entry) => entry.kind !== "release");
  rewrite(path, entries);
  const verification = replay(readEntries(path));
  assert.equal(verification.ok, false);
  assert.ok(
    verification.issues.some((issue) => issue.problem.includes("confirmed and were never released")),
    JSON.stringify(verification.issues),
  );
});

test("a release call that reached nobody does not count as telling them", async () => {
  const fake = await startFakeCalle([
    gather(PLUMBER, [2], "Option two works."),
    gather(TENANT, [2], "Option two works."),
    gather(SUPER, [2], "Option two works."),
    confirmYes(PLUMBER),
    {
      phone: TENANT,
      phase: "confirm",
      userLines: ["Speaking.", "Sorry, I cannot make that."],
      structuredResult: { answer: "decline", notes: "" },
    },
    { phone: PLUMBER, phase: "release", userLines: ["Please leave a message after the tone."] },
  ]);
  const port = await createSdkPort({ apiKey: "calle_test_key", baseUrl: fake.baseUrl });
  const path = join(mkdtempSync(join(tmpdir(), "mps-ledger-")), "ledger.jsonl");
  const result = await runCoordination({ request: coordinationRequest(), port, ledgerPath: path, pollIntervalMs: 5 });
  await fake.close();
  assert.deepEqual(result.unreleased, ["plumber"]);

  const entries = readEntries(path);
  const release = entries.find((entry) => entry.kind === "release");
  assert.ok(release !== undefined && release.kind === "release");
  assert.equal(release.result.call_status, "completed", "the call ended");
  assert.equal(release.result.acknowledged, false, "and told nobody");
  assert.equal(replay(entries).ok, true, "naming the debt is what makes it replay");

  // The same history with the debt dropped from the outcome. The release call is
  // still there and still reached nobody, so replay must not read it as delivery.
  rewrite(path, entries.map((entry) => (entry.kind === "outcome" ? { ...entry, unreleased: [] } : entry)));
  const verification = replay(readEntries(path));
  assert.equal(verification.ok, false);
  assert.ok(
    verification.issues.some((issue) => issue.problem.includes("plumber confirmed and were never released")),
    JSON.stringify(verification.issues),
  );
});

test("a confirmation credited from a late answer is caught", async () => {
  const { path, entries } = await confirmedLedger();
  const tampered = entries.map((entry) =>
    entry.kind === "commit" && entry.result.party_id === "tenant"
      ? { ...entry, result: { ...entry.result, within_window: false } }
      : entry,
  );
  rewrite(path, tampered);
  const verification = replay(readEntries(path));
  assert.equal(verification.ok, false);
  assert.ok(
    verification.issues.some((issue) => issue.problem.includes("landed outside the window")),
    JSON.stringify(verification.issues),
  );
});

test("a ledger with no outcome entry is an unfinished run", async () => {
  const { path, entries } = await confirmedLedger();
  rewrite(path, entries.filter((entry) => entry.kind !== "outcome"));
  const verification = replay(readEntries(path));
  assert.equal(verification.ok, false);
  assert.ok(verification.issues.some((issue) => issue.problem.includes("did not finish")));
});

test("a call count that does not match the entries is caught", async () => {
  const { path, entries } = await confirmedLedger();
  const tampered = entries.map((entry) =>
    entry.kind === "outcome" ? { ...entry, calls_placed: 3 } : entry,
  );
  rewrite(path, tampered);
  const verification = replay(readEntries(path));
  assert.equal(verification.ok, false);
  assert.ok(verification.issues.some((issue) => issue.problem.includes("does not match the 6 call entries")));
});
