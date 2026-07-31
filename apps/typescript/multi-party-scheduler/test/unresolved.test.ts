/**
 * Ambiguous CALL-E failures.
 *
 * A reply the server chose to send is definite: the call was not created and the
 * round can move on. No reply at all, a timeout, a rate limit, a conflict on the
 * idempotency key or a server error can each sit on top of a call that was
 * accepted, and so can a read that fails after the create got through. Those
 * leave a call that may be ringing somebody right now, so the same key is
 * re-issued to find it and nobody else is called until it is settled.
 */

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCoordination } from "../src/coordinate.js";
import { readEntries, replay } from "../src/ledger.js";
import { inspectLedger, resumeCoordination } from "../src/resume.js";
import { coordinationRequest, PLUMBER, SUPER, TENANT } from "./fixtures.js";
import { CalleCallError, stubPort, type StubScript } from "./stub.js";

/** 10am Pacific, which is when every stub call says it finished. */
const CLOCK = Date.parse("2026-08-04T17:00:00Z");

function ledgerPath(): string {
  return join(mkdtempSync(join(tmpdir(), "mps-unresolved-")), "ledger.jsonl");
}

function gather(phone: string, extra: Partial<StubScript> = {}): StubScript {
  return {
    phase: "gather",
    phone,
    userLines: ["Hello?", "Option two works."],
    structured: { available_options: [2], none_work: "no", notes: "" },
    ...extra,
  };
}

function confirm(phone: string, extra: Partial<StubScript> = {}): StubScript {
  return {
    phase: "confirm",
    phone,
    userLines: ["Speaking.", "Confirm, see you then."],
    structured: { answer: "confirm", notes: "" },
    ...extra,
  };
}

function release(phone: string, extra: Partial<StubScript> = {}): StubScript {
  return {
    phase: "release",
    phone,
    userLines: ["Hello?", "Okay, thanks for letting me know."],
    structured: { acknowledged: "yes", notes: "" },
    ...extra,
  };
}

const HAPPY: StubScript[] = [
  gather(PLUMBER),
  gather(TENANT),
  gather(SUPER),
  confirm(PLUMBER),
  confirm(TENANT),
  confirm(SUPER),
];

function noReply(): CalleCallError {
  return new CalleCallError("connection_error", "the request never got an answer", null);
}

function serverError(): CalleCallError {
  return new CalleCallError("internal_error", "CALL-E is having a bad day", 503);
}

async function run(scripts: StubScript[], path = ledgerPath()) {
  const port = stubPort(scripts);
  const result = await runCoordination({
    request: coordinationRequest(),
    port,
    ledgerPath: path,
    pollIntervalMs: 1,
    now: () => CLOCK,
  });
  return { result, port, path, entries: readEntries(path) };
}

test("an ambiguous create is reconciled under the same key, not dialled again", async () => {
  const scripts = [...HAPPY];
  scripts[0] = gather(PLUMBER, { createErrors: [noReply()] });
  const { result, port } = await run(scripts);
  assert.equal(result.outcome, "verbally_confirmed", "the reconciled call answered");
  const plumberGathers = port.creates.filter((call) => call.phase === "gather" && call.phone === PLUMBER);
  assert.equal(plumberGathers.length, 2, "one attempt, then the same key again");
  assert.equal(plumberGathers[0]?.key, plumberGathers[1]?.key, "the same idempotency key");
  assert.equal(result.calls_placed, 6, "reconciling is not a second call");
});

test("a create nobody can reconcile stops the round with the call unresolved", async () => {
  const scripts = [...HAPPY];
  scripts[0] = gather(PLUMBER, { createErrors: [serverError(), noReply()] });
  const { result, port, entries } = await run(scripts);
  assert.equal(result.outcome, "unresolved");
  assert.equal(port.creates.length, 2, "both attempts were for the same party");
  assert.equal(
    port.creates.some((call) => call.phone !== PLUMBER),
    false,
    "nobody else is called while a call may be live",
  );
  const first = entries.find((entry) => entry.kind === "gather");
  assert.ok(first !== undefined && first.kind === "gather");
  assert.equal(first.result.call_status, "unresolved");
  assert.deepEqual(first.feasible_after, first.feasible_before, "a call nobody can account for narrows nothing");
  assert.match(result.note, /internal_error/);
  assert.match(result.note, /by hand/);
  assert.equal(replay(entries).ok, true, JSON.stringify(replay(entries).issues));
});

test("a reply the server chose to send is definite and the round reads it as a refusal", async () => {
  const scripts = [...HAPPY];
  scripts[0] = gather(PLUMBER, {
    createErrors: [new CalleCallError("insufficient_balance", "no credit", 402)],
  });
  const { result, port, entries } = await run(scripts);
  assert.equal(result.outcome, "not_reached");
  assert.equal(port.creates.length, 1, "a refusal is not reconciled");
  const first = entries.find((entry) => entry.kind === "gather");
  assert.ok(first !== undefined && first.kind === "gather");
  assert.equal(first.result.call_status, "api_error");
});

test("a call that was created and cannot be read keeps its id and stops the round", async () => {
  const scripts = [...HAPPY];
  scripts[0] = gather(PLUMBER, { waitError: noReply(), readError: noReply() });
  const { result, entries, port } = await run(scripts);
  assert.equal(result.outcome, "unresolved");
  assert.equal(port.creates.length, 1);
  const first = entries.find((entry) => entry.kind === "gather");
  assert.ok(first !== undefined && first.kind === "gather");
  assert.equal(first.result.call_status, "unresolved");
  assert.equal(first.result.call_id, "call_stub1", "the call id is what makes it reconcilable");
  assert.match(result.note, /call_stub1/);
  assert.equal(replay(entries).ok, true, JSON.stringify(replay(entries).issues));
});

test("a nonterminal read back is unresolved, never a normal result", async () => {
  const scripts = [...HAPPY];
  scripts[0] = gather(PLUMBER, { status: "in_progress" });
  const { result, entries } = await run(scripts);
  assert.equal(result.outcome, "unresolved");
  const first = entries.find((entry) => entry.kind === "gather");
  assert.ok(first !== undefined && first.kind === "gather");
  assert.equal(first.result.call_status, "unresolved");
  assert.equal(first.result.reached_person, false);
  assert.match(first.result.notes, /last had this call as in_progress/);
  assert.match(result.note, /call_stub1/);
});

test("an unresolved confirm never tells anybody it is off, and resume settles it first", async () => {
  const scripts = [...HAPPY, release(PLUMBER), release(TENANT), release(SUPER)];
  scripts[4] = confirm(TENANT, { createErrors: [serverError(), serverError()] });
  const { result, port, path, entries } = await run(scripts);
  assert.equal(result.outcome, "unresolved");
  assert.equal(
    port.creates.some((call) => call.phase === "release"),
    false,
    "a call that may still confirm the time cannot be followed by calls saying it is off",
  );
  assert.deepEqual(result.unreleased, ["plumber"], "the yes already given is recorded as owed");
  const commit = entries.filter((entry) => entry.kind === "commit").at(-1);
  assert.ok(commit !== undefined && commit.kind === "commit");
  assert.equal(commit.result.party_id, "tenant");
  assert.equal(commit.result.call_status, "unresolved");
  assert.deepEqual(
    inspectLedger(entries).unsettled.map((held) => `${held.phase}:${held.party_id}`),
    ["confirm:tenant"],
    "resume owns exactly that call",
  );
  assert.equal(replay(entries).ok, true, JSON.stringify(replay(entries).issues));

  // A new process, so the create that was lost is re-issued under the same key.
  const settled = stubPort([...HAPPY, release(PLUMBER), release(TENANT), release(SUPER)]);
  const resumed = await resumeCoordination({
    request: coordinationRequest(),
    port: settled,
    ledgerPath: path,
    pollIntervalMs: 1,
    now: () => CLOCK,
  });
  assert.equal(resumed.outcome, "not_confirmed", "the superintendent was never asked");
  assert.deepEqual(resumed.unreleased, [], "both parties who said yes were told");
  assert.deepEqual(
    settled.creates.map((call) => `${call.phase}:${call.phone}`),
    [`confirm:${TENANT}`, `release:${TENANT}`, `release:${PLUMBER}`],
    "reconcile the unresolved call first, then tell everybody who said yes",
  );
  assert.equal(replay(readEntries(path)).ok, true);
});

test("an unresolved release call leaves the debt owed", async () => {
  const scripts = [...HAPPY, release(PLUMBER, { waitError: noReply(), readError: noReply() }), release(TENANT)];
  scripts[5] = confirm(SUPER, {
    userLines: ["Speaking.", "Sorry, something came up, I cannot make that."],
    structured: { answer: "decline", notes: "" },
  });
  const { result, entries } = await run(scripts);
  assert.equal(result.outcome, "not_confirmed");
  assert.deepEqual(result.unreleased, ["plumber"], "an unresolved release call told nobody");
  const owed = entries.filter((entry) => entry.kind === "release").map((entry) => entry.result);
  assert.equal(owed.some((held) => held.call_status === "unresolved" && !held.acknowledged), true);
  assert.deepEqual(inspectLedger(entries).owedReleases, ["plumber"]);
  assert.equal(replay(entries).ok, true, JSON.stringify(replay(entries).issues));
});
