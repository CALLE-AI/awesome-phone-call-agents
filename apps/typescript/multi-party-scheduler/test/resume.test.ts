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
import { placeCall, runCoordination } from "../src/coordinate.js";
import { readEntries, replay } from "../src/ledger.js";
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
 * the request: a run that crashed, an upgrade that touched one line of a call
 * script, then a resume, and the derived key is a different key. So the key the
 * create went out under is recorded and re-issued verbatim. The ledger below is
 * stamped with a key nothing could derive, which is the only way to prove where
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
    writeFileSync(
      path,
      `${readEntries(path)
        .map((entry) =>
          entry.kind === "commit" && entry.result.party_id === "superintendent"
            ? JSON.stringify({ ...entry, result: { ...entry.result, idempotency_key: recorded } })
            : JSON.stringify(entry),
        )
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
    await body({ port, path, request });
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

test("resume finishes a release nobody acknowledged instead of writing it off", async () => {
  await withOwedRelease(async ({ port, path, request }) => {
    const resumed = await resumeCoordination({ request, port, ledgerPath: path, pollIntervalMs: 5 });
    assert.notEqual(resumed.note, "nothing to resume");
    assert.deepEqual(resumed.unreleased, ["plumber"], "the machine answered again");
    assert.match(resumed.note, /still owed a release call: plumber/);
    assert.equal(resumed.calls_placed, 7, "6 recorded calls plus the release call it tried again");

    const entries = readEntries(path);
    assert.equal(
      entries.filter((entry) => entry.kind === "release").length,
      2,
      "resume called again rather than reading the first attempt as delivery",
    );
    const opened = entries.find((entry) => entry.kind === "resume_started");
    assert.ok(opened !== undefined && opened.kind === "resume_started");
    assert.deepEqual(opened.owed_releases, ["plumber"]);
    assert.equal(replay(entries).ok, true, JSON.stringify(replay(entries).issues));
  });
});
