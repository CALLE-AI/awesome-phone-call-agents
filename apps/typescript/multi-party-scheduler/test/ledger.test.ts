/**
 * Ledger and replay. Replay is the part that matters: it recomputes the feasible
 * set, the chosen slot and the outcome from the recorded answers, so a ledger
 * that says Thursday when the answers do not intersect on Thursday fails.
 */

import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSdkPort } from "../src/calle.js";
import { runCoordination } from "../src/coordinate.js";
import {
  canonicalJson,
  acquireLedgerLock,
  appendEntry,
  digestOf,
  LedgerError,
  LedgerLockError,
  LEDGER_MODE,
  readEntries,
  readLedger,
  replay,
  requestDigest,
} from "../src/ledger.js";
import type { CoordinationRequest, LedgerEntry } from "../src/types.js";
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

// An unresolved create with no call id is rebuilt from the request in hand, so
// anything that changes who gets dialled or what they hear has to move the
// digest. Otherwise resume passes its check, builds a different payload, gets a
// different idempotency key and places a second call to somebody else while the
// first one may still be live. The two computed slot fields are in here as well:
// `spoken` is rendered by the runtime's locale data rather than by this app, so a
// resume that would read a different line out loud is refused rather than run.
test("every call-affecting party field moves the request digest", () => {
  const base = requestDigest(coordinationRequest());
  const edits: [string, (request: ReturnType<typeof coordinationRequest>) => void][] = [
    ["phone", (request) => void (request.parties[0]!.phone = "+15550001111")],
    ["name", (request) => void (request.parties[0]!.name = "Someone Else")],
    ["role", (request) => void (request.parties[0]!.role = "deputy")],
    ["region", (request) => void (request.parties[0]!.region = "GB")],
    ["locale", (request) => void (request.parties[0]!.locale = "en-GB")],
    ["consentRecorded", (request) => void (request.parties[0]!.consentRecorded = !request.parties[0]!.consentRecorded)],
    ["callingHours.start", (request) => void (request.parties[0]!.callingHours.start = "07:00")],
    ["callingHours.timezone", (request) => void (request.parties[0]!.callingHours.timezone = "Europe/London")],
    ["party order", (request) => void request.parties.reverse()],
    ["slot start", (request) => void (request.slots[0]!.start = "2026-08-09T10:00:00-07:00")],
    ["slot option", (request) => void (request.slots[0]!.option = 9)],
    ["slot spoken", (request) => void (request.slots[0]!.spoken = "option 1, Thursday, August 6 at 10:00 a.m.")],
    ["slot startMs", (request) => void (request.slots[0]!.startMs += 60_000)],
  ];
  for (const [what, edit] of edits) {
    const request = coordinationRequest();
    edit(request);
    assert.notEqual(requestDigest(request), base, `editing ${what} must not pass a resume check`);
  }
});

// Every version of this digest that named the fields it bound left one out: the
// party fields first, then `requestId`, which is what every idempotency key
// starts with and what sits in the metadata of every call. So the digest binds the
// request whole and this pins that. The map is typed over every key of
// `CoordinationRequest`, so a new field fails the typecheck here until somebody
// says how it moves the digest, and the key comparison catches a field that
// reaches the object without reaching the type.
test("every field of the request is bound into the digest", () => {
  const base = requestDigest(coordinationRequest());
  const edits: Record<keyof CoordinationRequest, (request: CoordinationRequest) => void> = {
    requestId: (request) => void (request.requestId = "ash-lane-3b-leak-2"),
    meeting: (request) => void (request.meeting.organizer = "a different organizer"),
    slots: (request) => void (request.slots[0]!.start = "2026-08-09T10:00:00-07:00"),
    parties: (request) => void (request.parties[0]!.phone = "+15550001111"),
    policy: (request) => void (request.policy.maxCalls += 1),
  };
  assert.deepEqual(
    Object.keys(edits).sort(),
    Object.keys(coordinationRequest()).sort(),
    "a request field with no edit here is a field nothing proves is bound",
  );
  for (const [field, edit] of Object.entries(edits)) {
    const request = coordinationRequest();
    edit(request);
    assert.notEqual(requestDigest(request), base, `editing ${field} must not pass a resume check`);
  }
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

function tempLedgerPath(prefix: string): string {
  return join(mkdtempSync(join(tmpdir(), prefix)), "ledger.jsonl");
}

const RESUME_ENTRY: LedgerEntry = {
  kind: "resume_started",
  at: "2026-08-04T17:05:00.000Z",
  entries_before: 0,
  ambiguous: [],
  owed_releases: [],
};

test("a ledger that already exists is put back to 0600 on the next append", () => {
  const path = tempLedgerPath("mps-mode-");
  writeFileSync(path, "");
  chmodSync(path, 0o644);
  assert.equal(statSync(path).mode & 0o777, 0o644, "a file somebody else can read");
  appendEntry(path, RESUME_ENTRY);
  assert.equal(statSync(path).mode & 0o777, LEDGER_MODE, "and it is not after an append");
  appendEntry(path, RESUME_ENTRY);
  assert.equal(statSync(path).mode & 0o777, LEDGER_MODE);
  assert.equal(readEntries(path).length, 2, "the entries still landed");
});

test("the lock file carries the ledger mode too", () => {
  const path = tempLedgerPath("mps-mode-");
  const lock = acquireLedgerLock(path);
  assert.equal(statSync(lock.path).mode & 0o777, LEDGER_MODE);
  lock.release();
});

test("a target that is not a regular file is refused rather than written to", () => {
  assert.throws(
    () => appendEntry("/dev/null", RESUME_ENTRY),
    (error: unknown) => {
      assert.ok(error instanceof LedgerError, `expected LedgerError, got ${String(error)}`);
      assert.match(error.message, /not a regular file/);
      return true;
    },
  );
});

test("a ledger torn by a crash mid append is read without that last half line", async () => {
  const { path, entries } = await confirmedLedger();
  const text = readFileSync(path, "utf8");
  writeFileSync(path, text.slice(0, text.length - 40));
  const read = readLedger(path);
  assert.equal(read.truncatedTail, true);
  assert.equal(read.entries.length, entries.length - 1, "the half written entry is not counted");
  const verification = replay(read.entries);
  assert.equal(verification.ok, false, "and the run reads as unfinished, which it is");
  assert.ok(verification.issues.some((issue) => issue.problem.includes("did not finish")));
});

test("a broken line anywhere but the end is a broken history", async () => {
  const { entries } = await confirmedLedger();
  const path = tempLedgerPath("mps-torn-");
  const lines = entries.map((entry) => JSON.stringify(entry));
  lines[2] = lines[2]!.slice(0, 30);
  writeFileSync(path, `${lines.join("\n")}\n`);
  assert.throws(
    () => readEntries(path),
    (error: unknown) => {
      assert.ok(error instanceof LedgerError, `expected LedgerError, got ${String(error)}`);
      assert.match(error.message, /line 3 is not a ledger entry/);
      return true;
    },
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
