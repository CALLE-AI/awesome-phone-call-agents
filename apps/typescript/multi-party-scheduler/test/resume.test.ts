/**
 * Recovery, end to end over the real client against the local fake CALL-E.
 *
 * The two failures that matter are a process that dies between the yes and the
 * release call and a create response that is lost while the call itself goes
 * ahead. Both can leave somebody expecting an appointment that is not happening.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CalleCallError, createSdkPort, type CallePort } from "../src/calle.js";
import { callInput, placeCall, runCoordination } from "../src/coordinate.js";
import { digestOf, readEntries, replay } from "../src/ledger.js";
import { inspectLedger, resumeCoordination, ResumeError } from "../src/resume.js";
import { confirmSchema, confirmTask } from "../src/script.js";
import type { CommitResult, LedgerEntry } from "../src/types.js";
import { startFakeCalle, type FakeScript } from "../fake/calle-server.js";
import { coordinationRequest, PLUMBER, SUPER, TENANT } from "./fixtures.js";

function gather(phone: string): FakeScript {
  return {
    phone,
    phase: "gather",
    userLines: ["Hello?", "Option two works for me."],
    structuredResult: { available_options: [2], none_work: "no", notes: "" },
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

function releaseOk(phone: string): FakeScript {
  return {
    phone,
    phase: "release",
    userLines: ["Hello?", "Okay, thanks for letting me know."],
    structuredResult: { acknowledged: "yes", notes: "" },
  };
}

const FULL_RUN: FakeScript[] = [
  gather(PLUMBER),
  gather(TENANT),
  gather(SUPER),
  confirmYes(PLUMBER),
  confirmYes(TENANT),
  confirmYes(SUPER),
  releaseOk(PLUMBER),
  releaseOk(TENANT),
  releaseOk(SUPER),
];

function ledgerPath(): string {
  return join(mkdtempSync(join(tmpdir(), "mps-resume-")), "ledger.jsonl");
}

async function withFake(
  body: (
    port: CallePort,
    fake: Awaited<ReturnType<typeof startFakeCalle>>,
  ) => Promise<void>,
): Promise<void> {
  const fake = await startFakeCalle(FULL_RUN);
  const port = await createSdkPort({ apiKey: "calle_test_key", baseUrl: fake.baseUrl });
  try {
    await body(port, fake);
  } finally {
    await fake.close();
  }
}

function phones(fake: Awaited<ReturnType<typeof startFakeCalle>>, phase: string): (string | undefined)[] {
  return fake.created.filter((call) => call.phase === phase).map((call) => call.phones[0]);
}

test("a crash between the yes and the release call is finished by resume", async () => {
  await withFake(async (port, fake) => {
    const request = coordinationRequest();
    const path = ledgerPath();
    await assert.rejects(
      () =>
        runCoordination({
          request,
          port,
          ledgerPath: path,
          pollIntervalMs: 5,
          onProgress: (line) => {
            if (line === "  tenant: confirmed.") {
              throw new Error("power cut");
            }
          },
        }),
      /power cut/,
    );
    const crashed = replay(readEntries(path));
    assert.equal(crashed.ok, false);
    assert.ok(crashed.issues.some((issue) => issue.problem.includes("did not finish")));
    assert.deepEqual(phones(fake, "release"), [], "nobody has been told yet");

    const resumed = await resumeCoordination({ request, port, ledgerPath: path, pollIntervalMs: 5 });
    assert.equal(resumed.outcome, "not_confirmed");
    assert.deepEqual(resumed.unreleased, []);
    assert.equal(resumed.calls_placed, 7, "5 recorded calls plus the 2 releases the run owed");
    assert.deepEqual(phones(fake, "release"), [TENANT, PLUMBER], "most recent yes first");

    const after = replay(readEntries(path));
    assert.equal(after.ok, true, JSON.stringify(after.issues));
    assert.equal(after.outcome, "not_confirmed");
  });
});

test("a confirm whose create response was lost stops the round, then resume finds the yes", async () => {
  await withFake(async (port, fake) => {
    const request = coordinationRequest();
    const path = ledgerPath();
    // The call is created, then the answer never gets back to us.
    const lossy: CallePort = {
      ...port,
      async createCall(input, key) {
        const call = await port.createCall(input, key);
        if (key.startsWith("mps-ash-lane-3b-leak-confirm-superintendent")) {
          throw new CalleCallError("connection_error", "the create response never arrived");
        }
        return call;
      },
    };

    const first = await runCoordination({ request, port: lossy, ledgerPath: path, pollIntervalMs: 5 });
    assert.equal(first.outcome, "unresolved");
    assert.deepEqual(first.unreleased, ["plumber", "tenant"], "both yeses are recorded as owed");
    assert.equal(phones(fake, "confirm").length, 3, "the superintendent was called, we just never saw it");
    assert.deepEqual(
      phones(fake, "release"),
      [],
      "nobody is told it is off while a call that could confirm it may be live",
    );
    assert.match(first.note, /may still be live/);

    const resumed = await resumeCoordination({ request, port, ledgerPath: path, pollIntervalMs: 5 });
    assert.equal(resumed.outcome, "verbally_confirmed", "the lost call had said yes all along");
    assert.deepEqual(resumed.unreleased, []);
    assert.deepEqual(phones(fake, "release"), [], "so there was never anything to undo");
    const entries = readEntries(path);
    const reconciled = entries.find((entry) => entry.kind === "reconcile");
    assert.ok(reconciled !== undefined && reconciled.kind === "reconcile");
    assert.equal(reconciled.result.party_id, "superintendent");
    assert.equal(reconciled.result.confirmed, true, "the same idempotency key found the same call");
    const after = replay(entries);
    assert.equal(after.ok, true, JSON.stringify(after.issues));
  });
});

test("a finished run with nothing owed is left exactly as it was", async () => {
  await withFake(async (port, fake) => {
    const request = coordinationRequest();
    const path = ledgerPath();
    const first = await runCoordination({ request, port, ledgerPath: path, pollIntervalMs: 5 });
    assert.equal(first.outcome, "verbally_confirmed");
    const before = readFileSync(path, "utf8");

    const resumed = await resumeCoordination({ request, port, ledgerPath: path, pollIntervalMs: 5 });
    assert.equal(resumed.outcome, "verbally_confirmed");
    assert.equal(resumed.note, "nothing to resume");
    assert.equal(readFileSync(path, "utf8"), before, "resume writes nothing when nothing is owed");
    assert.deepEqual(phones(fake, "release"), []);
  });
});

test("resume refuses a ledger another request wrote", async () => {
  await withFake(async (port) => {
    const request = coordinationRequest();
    const path = ledgerPath();
    await runCoordination({ request, port, ledgerPath: path, pollIntervalMs: 5 });
    const other = coordinationRequest({
      meeting: { ...coordinationRequest().meeting, purpose: "a different job at 14 Ash Lane" },
    });
    await assert.rejects(
      () => resumeCoordination({ request: other, port, ledgerPath: path, pollIntervalMs: 5 }),
      (error: unknown) => {
        assert.ok(error instanceof ResumeError);
        assert.match(error.message, /written from a different request/);
        return true;
      },
    );
  });
});

/**
 * Only the id is edited. Every word a call would say is identical, so nothing in
 * the request changes who is rung or what they hear. The id still decides the
 * call: it is the first thing every idempotency key is built from and it rides in
 * the metadata, so a resume that accepted this ledger would reconcile an
 * accepted-but-lost create under a key CALL-E has never seen and place a second
 * call to somebody whose first one may still be live.
 */
test("resume refuses a ledger when only the request id was edited", async () => {
  await withFake(async (port, fake) => {
    const request = coordinationRequest();
    const path = ledgerPath();
    await runCoordination({ request, port, ledgerPath: path, pollIntervalMs: 5 });
    const placed = fake.created.length;
    const renamed = coordinationRequest({ request_id: "ash-lane-3b-leak-2" });
    await assert.rejects(
      () => resumeCoordination({ request: renamed, port, ledgerPath: path, pollIntervalMs: 5 }),
      (error: unknown) => {
        assert.ok(error instanceof ResumeError);
        assert.match(error.message, /written from a different request/);
        return true;
      },
    );
    assert.equal(fake.created.length, placed, "and nothing was dialled");
  });
});

/**
 * The key is durable state, not something recomputed.
 *
 * Deriving it again reads the task text, which lives in this repo rather than in
 * the request. A run crashes, an upgrade touches one line of a call script, the
 * resume derives a key CALL-E has never seen and a second phone rings. So the key
 * the create went out under is recorded and re-issued verbatim. The ledger below
 * is stamped with a key nothing could derive, which is the only way to prove where
 * the string on the wire came from.
 */
test("resume re-issues the key the ledger recorded rather than deriving a new one", async () => {
  await withFake(async (port, fake) => {
    const request = coordinationRequest();
    const path = ledgerPath();
    const lossy: CallePort = {
      ...port,
      async createCall(input, key) {
        const call = await port.createCall(input, key);
        if (key.startsWith("mps-ash-lane-3b-leak-confirm-superintendent")) {
          throw new CalleCallError("connection_error", "the create response never arrived");
        }
        return call;
      },
    };
    const first = await runCoordination({ request, port: lossy, ledgerPath: path, pollIntervalMs: 5 });
    assert.equal(first.outcome, "unresolved");
    const lost = readEntries(path).find(
      (entry) => entry.kind === "commit" && entry.result.party_id === "superintendent",
    );
    assert.ok(lost !== undefined && lost.kind === "commit");
    assert.equal(lost.result.call_id, null, "the create response never came back");
    assert.equal(
      lost.result.idempotency_key,
      fake.created.at(-1)?.idempotencyKey,
      "so the recorded key is the only handle on that call",
    );

    const recorded = "mps-key-only-this-ledger-knows";
    const original = lost.result.idempotency_key;
    // The attempt record moves with the key. A key with no attempt record behind it
    // is refused and rightly: nothing would say which payload or which provider that
    // string went out against, so nothing could check either before sending it again.
    writeFileSync(
      path,
      `${readEntries(path)
        .map((entry) => {
          if (entry.kind === "commit" && entry.result.party_id === "superintendent") {
            return JSON.stringify({ ...entry, result: { ...entry.result, idempotency_key: recorded } });
          }
          if (entry.kind === "call_attempt" && entry.idempotency_key === original) {
            return JSON.stringify({ ...entry, idempotency_key: recorded });
          }
          return JSON.stringify(entry);
        })
        .join("\n")}\n`,
    );

    await resumeCoordination({ request, port, ledgerPath: path, pollIntervalMs: 5 });
    assert.equal(fake.created.at(-1)?.idempotencyKey, recorded, "resume sent the key it read");
    const reconciled = readEntries(path).find((entry) => entry.kind === "reconcile");
    assert.ok(reconciled !== undefined && reconciled.kind === "reconcile");
    assert.equal(reconciled.result.idempotency_key, recorded, "and the entry names it");
  });
});

/**
 * What an upgrade between the crash and the resume looks like from CALL-E's side:
 * the recorded key with different words behind it. The API answers 409 rather than
 * placing anything, 409 leaves the call unknown, so it comes back unresolved and
 * the round stops. Nobody is rung twice either way, which is the whole point of
 * re-issuing the recorded key instead of deriving one that would have been new.
 */
test("a recorded key re-issued with a different body stops rather than ringing again", async () => {
  const fake = await startFakeCalle([confirmYes(PLUMBER)]);
  const port = await createSdkPort({ apiKey: "calle_test_key", baseUrl: fake.baseUrl });
  try {
    const request = coordinationRequest();
    const party = request.parties[0]!;
    const slot = request.slots[1]!;
    const key = "mps-ash-lane-3b-leak-confirm-plumber-thu-14-0123456789ab";
    const place = (task: string) =>
      placeCall({
        request,
        port,
        party,
        phase: "confirm",
        slot,
        task,
        schema: confirmSchema(),
        timeoutMs: 2_000,
        pollIntervalMs: 5,
        key,
      });

    const original = await place(confirmTask(request, party, slot));
    assert.equal(original.unresolved, false, "the call was placed and read back");
    assert.equal(original.idempotencyKey, key);

    const upgraded = await place(`${confirmTask(request, party, slot)}\n- A rule that was not in the script before.`);
    assert.equal(upgraded.unresolved, true, "a call that may exist is never written off");
    assert.match(upgraded.errorCode ?? "", /idempotency_conflict/);
    assert.equal(upgraded.idempotencyKey, key, "the entry names the key that was sent");
    assert.equal(fake.created.length, 1, "and the new body never became a second call");
  } finally {
    await fake.close();
  }
});

/**
 * The window inside `placeCall`.
 *
 * CALL-E accepts a call and the process dies before anything records what it did.
 * Two states can be on disk: the attempt record on its own or the attempt with the
 * accepted call id after it. Both ledgers below are built by running a real
 * coordination against the fake server and cutting the file where the process
 * would have stopped, so the call really is at the provider under the key the
 * attempt names, which is the whole difficulty.
 */
function cutAt(path: string, at: (entry: LedgerEntry) => boolean): LedgerEntry[] {
  const entries = readEntries(path);
  const index = entries.findIndex(at);
  assert.notEqual(index, -1, "the ledger holds no entry to cut this crash at");
  const kept = entries.slice(0, index + 1);
  writeFileSync(path, `${kept.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  return kept;
}

function watch(port: CallePort, keys: string[]): CallePort {
  return {
    ...port,
    async createCall(input, key) {
      keys.push(key);
      return port.createCall(input, key);
    },
  };
}

function confirmAttempt(entries: LedgerEntry[], partyId: string): LedgerEntry & { kind: "call_attempt" } {
  const attempt = entries.find(
    (entry) => entry.kind === "call_attempt" && entry.phase === "confirm" && entry.party_id === partyId,
  );
  assert.ok(attempt !== undefined && attempt.kind === "call_attempt", `no confirm attempt for ${partyId}`);
  return attempt;
}

test("a crash between the create and the ledger append leaves the key resume settles that call with", async () => {
  await withFake(async (port, fake) => {
    const request = coordinationRequest();
    const path = ledgerPath();
    const keys: string[] = [];
    const watched = watch(port, keys);
    const first = await runCoordination({ request, port: watched, ledgerPath: path, pollIntervalMs: 5 });
    assert.equal(first.outcome, "verbally_confirmed");
    const placed = fake.created.length;
    const sent = keys.length;

    // The superintendent's confirm call is at CALL-E. Nothing about it reached the
    // ledger except the line `placeCall` wrote before the create.
    const kept = cutAt(
      path,
      (entry) => entry.kind === "call_attempt" && entry.phase === "confirm" && entry.party_id === "superintendent",
    );
    const attempt = confirmAttempt(kept, "superintendent");
    assert.equal(attempt.idempotency_key, keys.at(-1), "the recorded key is the string that went on the wire");
    const party = request.parties[2]!;
    const slot = request.slots.find((candidate) => candidate.id === attempt.slot_id)!;
    assert.equal(
      attempt.payload_digest,
      digestOf(callInput(request, party, "confirm", slot, confirmTask(request, party, slot), confirmSchema())),
      "and the record is bound to the payload that key was taken over",
    );

    const state = inspectLedger(kept);
    assert.deepEqual(
      state.unsettled.map((held) => `${held.phase}:${held.party_id}`),
      ["confirm:superintendent"],
      "which is what makes the call recoverable at all",
    );
    assert.equal(state.unsettled[0]?.call_id, null, "no accepted id ever reached the ledger");
    assert.equal(state.unsettled[0]?.idempotency_key, attempt.idempotency_key);
    const crashed = replay(kept);
    assert.equal(crashed.ok, false);
    assert.ok(
      crashed.issues.some((issue) => issue.problem.includes("superintendent's confirm call was attempted")),
      JSON.stringify(crashed.issues),
    );

    const resumed = await resumeCoordination({ request, port: watched, ledgerPath: path, pollIntervalMs: 5 });
    assert.equal(resumed.outcome, "verbally_confirmed", "the call CALL-E already held had said yes");
    assert.equal(keys.length, sent + 1, "one create, under the key the ledger recorded");
    assert.equal(keys.at(-1), attempt.idempotency_key);
    assert.equal(fake.created.length, placed, "so CALL-E answered with the call it had and nothing rang twice");
    assert.deepEqual(phones(fake, "release"), [], "and nobody was told it was off");
    const after = readEntries(path);
    const reconciled = after.find((entry) => entry.kind === "reconcile");
    assert.ok(reconciled !== undefined && reconciled.kind === "reconcile");
    assert.equal(reconciled.result.confirmed, true);
    assert.equal(reconciled.result.idempotency_key, attempt.idempotency_key);
    assert.equal(replay(after).ok, true, JSON.stringify(replay(after).issues));
  });
});

test("a crash after the accepted id was recorded settles that call without placing one", async () => {
  await withFake(async (port, fake) => {
    const request = coordinationRequest();
    const path = ledgerPath();
    const keys: string[] = [];
    const watched = watch(port, keys);
    await runCoordination({ request, port: watched, ledgerPath: path, pollIntervalMs: 5 });
    const placed = fake.created.length;
    const sent = keys.length;
    const key = confirmAttempt(readEntries(path), "superintendent").idempotency_key;

    // One line later than the crash above: the id CALL-E returned is on disk, so
    // this call can be settled by reading it rather than by re-issuing anything.
    const kept = cutAt(path, (entry) => entry.kind === "call_accepted" && entry.idempotency_key === key);
    const accepted = kept.at(-1);
    assert.ok(accepted !== undefined && accepted.kind === "call_accepted");
    const state = inspectLedger(kept);
    assert.equal(state.unsettled[0]?.call_id, accepted.call_id, "the accepted id is what resume settles against");
    assert.equal(state.unsettled[0]?.idempotency_key, key);

    const resumed = await resumeCoordination({ request, port: watched, ledgerPath: path, pollIntervalMs: 5 });
    assert.equal(resumed.outcome, "verbally_confirmed");
    assert.equal(keys.length, sent, "reading a call places none, so no create went out at all");
    assert.equal(fake.created.length, placed);
    assert.equal(resumed.calls_placed, 5, "and looking one up is not charged to the budget");
    const after = readEntries(path);
    const reconciled = after.find((entry) => entry.kind === "reconcile");
    assert.ok(reconciled !== undefined && reconciled.kind === "reconcile");
    assert.equal(reconciled.placed_call, false);
    assert.equal(reconciled.result.call_id, accepted.call_id);
    assert.equal(reconciled.result.confirmed, true);
    assert.equal(replay(after).ok, true, JSON.stringify(replay(after).issues));
  });
});

test("a gather call nothing settled is reported for a person, never dialled again", async () => {
  await withFake(async (port, fake) => {
    const request = coordinationRequest();
    const path = ledgerPath();
    await runCoordination({ request, port, ledgerPath: path, pollIntervalMs: 5 });
    const kept = cutAt(
      path,
      (entry) => entry.kind === "call_attempt" && entry.phase === "gather" && entry.party_id === "tenant",
    );
    const placed = fake.created.length;
    const state = inspectLedger(kept);
    assert.deepEqual(state.unsettledGathers, ["tenant"]);
    assert.deepEqual(state.unsettled, [], "nothing here is recovery's to settle");

    const lines: string[] = [];
    const resumed = await resumeCoordination({
      request,
      port,
      ledgerPath: path,
      pollIntervalMs: 5,
      onProgress: (line) => lines.push(line),
    });
    assert.equal(resumed.outcome, "not_confirmed");
    assert.equal(fake.created.length, placed, "resume never gathers again, so it dialled nobody");
    assert.match(resumed.note, /a gather call nobody can account for, which resume does not settle: tenant/);
    assert.ok(
      lines.some((line) => line.includes("tenant") && line.includes("check that call by hand")),
      lines.join(" | "),
    );
    const after = readEntries(path);
    const opened = after.find((entry) => entry.kind === "resume_started");
    assert.ok(opened !== undefined && opened.kind === "resume_started");
    assert.deepEqual(opened.ambiguous, ["gather:tenant"], "the open call is named even though resume leaves it");
    const verification = replay(after);
    assert.equal(verification.ok, false, "that call is still unaccounted for and the ledger says so");
    assert.ok(
      verification.issues.some((issue) => issue.problem.includes("tenant's gather call was attempted")),
      JSON.stringify(verification.issues),
    );
  });
});

/**
 * The one ledger shape recovery must refuse.
 *
 * A call with no id and no recorded key. The key could be derived again. A derived
 * key is built from the task text in this repo, so it may not be the string the lost
 * create used: a key CALL-E has never seen places a second call to somebody whose
 * first one may still be live. Only a ledger written before the key was recorded
 * looks like this. The answer is to name it for a person rather than to guess. The
 * two who did say yes are still told it is off.
 */
test("an unsettled call with no key and no call id is refused rather than dialled", async () => {
  await withFake(async (port, fake) => {
    const request = coordinationRequest();
    const path = ledgerPath();
    const lossy: CallePort = {
      ...port,
      async createCall(input, key) {
        const call = await port.createCall(input, key);
        if (key.startsWith("mps-ash-lane-3b-leak-confirm-superintendent")) {
          throw new CalleCallError("connection_error", "the create response never arrived");
        }
        return call;
      },
    };
    const first = await runCoordination({ request, port: lossy, ledgerPath: path, pollIntervalMs: 5 });
    assert.equal(first.outcome, "unresolved");
    const lost = readEntries(path).find(
      (entry) => entry.kind === "commit" && entry.result.party_id === "superintendent",
    );
    assert.ok(lost !== undefined && lost.kind === "commit");
    assert.equal(lost.result.call_id, null, "the create response never came back");
    const key = lost.result.idempotency_key;

    // Back to what that ledger looked like before this round: no attempt records
    // and no key on the entry, so nothing on disk knows what went on the wire.
    const legacy = readEntries(path)
      .filter(
        (entry) =>
          !((entry.kind === "call_attempt" || entry.kind === "call_accepted") && entry.idempotency_key === key),
      )
      .map((entry) =>
        entry.kind === "commit" && entry.result.party_id === "superintendent"
          ? { ...entry, result: { ...entry.result, idempotency_key: null } }
          : entry,
      );
    writeFileSync(path, `${legacy.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
    const state = inspectLedger(legacy);
    assert.deepEqual(state.unsettled.map((held) => `${held.phase}:${held.party_id}`), ["confirm:superintendent"]);
    assert.equal(state.unsettled[0]?.idempotency_key, null, "nothing to re-issue");

    const resumed = await resumeCoordination({ request, port, ledgerPath: path, pollIntervalMs: 5 });
    assert.equal(
      phones(fake, "confirm").length,
      3,
      "no fourth confirm call: a derived key could ring the superintendent a second time",
    );
    assert.match(resumed.note, /still unsettled, check by hand: superintendent/);
    assert.equal(resumed.outcome, "not_confirmed");
    assert.deepEqual(phones(fake, "release"), [TENANT, PLUMBER], "and the two who said yes were still told");
    assert.deepEqual(resumed.unreleased, []);
  });
});

/**
 * A run where the one release call it owed reached an answering machine. The
 * call completed, so nothing is left to settle. The person still has not been
 * told. That gap is what the debt rules below are about.
 */
const MACHINE_RELEASE: FakeScript[] = [
  gather(PLUMBER),
  gather(TENANT),
  gather(SUPER),
  confirmYes(PLUMBER),
  {
    phone: TENANT,
    phase: "confirm",
    userLines: ["Speaking.", "Sorry, I cannot make that."],
    structuredResult: { answer: "decline", notes: "" },
  },
  { phone: PLUMBER, phase: "release", userLines: ["Please leave a message after the tone."] },
];

async function withOwedRelease(
  body: (args: {
    port: CallePort;
    path: string;
    request: ReturnType<typeof coordinationRequest>;
    fake: Awaited<ReturnType<typeof startFakeCalle>>;
  }) => Promise<void>,
): Promise<void> {
  const fake = await startFakeCalle(MACHINE_RELEASE);
  const port = await createSdkPort({ apiKey: "calle_test_key", baseUrl: fake.baseUrl });
  const request = coordinationRequest();
  const path = ledgerPath();
  try {
    const first = await runCoordination({ request, port, ledgerPath: path, pollIntervalMs: 5 });
    assert.equal(first.outcome, "not_confirmed");
    assert.deepEqual(first.unreleased, ["plumber"], "the release call reached a machine");
    await body({ port, path, request, fake });
  } finally {
    await fake.close();
  }
}

test("a terminal release call that reached nobody leaves the debt owed", async () => {
  await withOwedRelease(async ({ path }) => {
    const entries = readEntries(path);
    const state = inspectLedger(entries);
    assert.deepEqual(state.released, [], "nobody acknowledged anything");
    assert.deepEqual(state.owedReleases, ["plumber"]);

    const machine = entries.find((entry) => entry.kind === "release");
    assert.ok(machine !== undefined && machine.kind === "release");
    const later = (overrides: Partial<CommitResult>): LedgerEntry => ({
      ...machine,
      result: { ...machine.result, ...overrides },
    });

    // A release call that ended and reached nobody cannot erase a debt the
    // outcome entry already recorded. The last three are statuses this API never
    // returns, which must not be read as delivery either.
    for (const status of ["failed", "canceled", "no_answer", "busy", "voicemail"]) {
      assert.deepEqual(
        inspectLedger([...entries, later({ call_status: status })]).owedReleases,
        ["plumber"],
        `a ${status} release call must not count as delivery`,
      );
    }

    // Acknowledged delivery is the only thing that clears it.
    const settled = inspectLedger([...entries, later({ acknowledged: true, reached_person: true })]);
    assert.deepEqual(settled.released, ["plumber"]);
    assert.deepEqual(settled.owedReleases, []);
  });
});

/**
 * The retry has to be a call the provider has never seen.
 *
 * Everything else in an idempotency key is stable across attempts, which is what
 * makes the key a reservation. So a release call derived the key its first attempt
 * had used, CALL-E answered with the call that reached the machine and nothing rang.
 * A second ledger line and a second charge against the budget looked like a retry
 * from the inside while the person was never called again. This test counts calls the
 * provider created, because that is the only thing that means somebody's phone rang.
 *
 * A new key is a phone ringing rather than a lookup, so the retry is asked for:
 * `retryRelease` is `--retry-release`. What the same ledger does without it is in
 * `settled.test.ts`, beside the rest of the rule.
 */
test("resume finishes a release nobody acknowledged instead of writing it off", async () => {
  await withOwedRelease(async ({ port, path, request, fake }) => {
    const resumed = await resumeCoordination({
      request,
      port,
      ledgerPath: path,
      pollIntervalMs: 5,
      retryRelease: true,
    });
    assert.notEqual(resumed.note, "nothing to resume");
    assert.deepEqual(resumed.unreleased, ["plumber"], "the machine answered again");
    assert.match(resumed.note, /still owed a release call: plumber/);
    assert.equal(resumed.calls_placed, 7, "6 recorded calls plus the release call it tried again");

    const releases = fake.created.filter((call) => call.phase === "release");
    assert.deepEqual(releases.map((call) => call.phones[0]), [PLUMBER, PLUMBER], "the phone rang twice");
    assert.notEqual(releases[0]?.id, releases[1]?.id, "two calls at CALL-E, not one answered twice");
    assert.notEqual(releases[0]?.idempotencyKey, releases[1]?.idempotencyKey);
    assert.match(releases[0]?.idempotencyKey ?? "", /-a1$/);
    assert.match(releases[1]?.idempotencyKey ?? "", /-a2$/, "the attempt number is what made it a new call");

    const entries = readEntries(path);
    const recorded = entries
      .filter((entry) => entry.kind === "release")
      .map((entry) => (entry.kind === "release" ? entry.result : null));
    assert.equal(recorded.length, 2, "resume called again rather than reading the first attempt as delivery");
    assert.deepEqual(
      recorded.map((result) => result?.call_id),
      releases.map((call) => call.id),
      "and each entry names the call it was",
    );
    const attempts = entries
      .filter((entry) => entry.kind === "call_attempt" && entry.phase === "release")
      .map((entry) => (entry.kind === "call_attempt" ? entry.attempt : 0));
    assert.deepEqual(attempts, [1, 2], "the ledger holds the identity each attempt went out under");

    const opened = entries.find((entry) => entry.kind === "resume_started");
    assert.ok(opened !== undefined && opened.kind === "resume_started");
    assert.deepEqual(opened.owed_releases, ["plumber"]);
    assert.equal(replay(entries).ok, true, JSON.stringify(replay(entries).issues));
  });
});
