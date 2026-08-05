/**
 * What a second run may do with a ledger that already records a coordination.
 *
 * The ledger is the coordination's durable state and the attempt number in every
 * idempotency key is counted from it, so a run pointed at a ledger that already holds
 * a round derives a key the provider has never seen for every call in it. From the
 * inside that looks like a retry. On the phones it is everybody rung again about an
 * answer already on disk. These tests count the calls the fake provider actually
 * created, because that is the only thing that means a handset rang.
 *
 * The rule they pin: a key is minted for a call this ledger holds no attempt for and
 * the one exception is a release retry that was asked for and whose last attempt is
 * settled. A coordination that finished is read back, one that did not belongs to
 * `resume`, which sends the key the ledger recorded rather than a new one.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSdkPort, type CallePort } from "../src/calle.js";
import { AlreadyCoordinatedError, releaseRound, runCoordination } from "../src/coordinate.js";
import { attemptToMint, readEntries, replay } from "../src/ledger.js";
import { resumeCoordination } from "../src/resume.js";
import type { CommitResult, LedgerEntry, Phase } from "../src/types.js";
import { startFakeCalle, type FakeCalle, type FakeScript } from "../fake/calle-server.js";
import { coordinationRequest, PLUMBER, SUPER, TENANT } from "./fixtures.js";
import { stubPort } from "./stub.js";

/** 10am Pacific, which is when every stub call says it finished. */
const CLOCK = Date.parse("2026-08-04T17:00:00Z");

function ledgerPath(): string {
  return join(mkdtempSync(join(tmpdir(), "mps-settled-")), "ledger.jsonl");
}

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

/** Everybody answers, everybody confirms. This is the ledger in the report. */
const CONFIRMED: FakeScript[] = [
  gather(PLUMBER),
  gather(TENANT),
  gather(SUPER),
  confirmYes(PLUMBER),
  confirmYes(TENANT),
  confirmYes(SUPER),
];

/** The same, plus the release calls an interrupted round leaves owed. */
const WITH_RELEASES: FakeScript[] = [...CONFIRMED, releaseOk(PLUMBER), releaseOk(TENANT)];

/** The tenant pulls out and the one release call the run owes reaches a machine. */
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

async function withFake(
  scripts: FakeScript[],
  body: (port: CallePort, fake: FakeCalle) => Promise<void>,
): Promise<void> {
  const fake = await startFakeCalle(scripts);
  const port = await createSdkPort({ apiKey: "calle_test_key", baseUrl: fake.baseUrl });
  try {
    await body(port, fake);
  } finally {
    await fake.close();
  }
}

/**
 * The report, verbatim. Two live runs against the same completed durable ledger.
 *
 * Before this the first run created 6 calls with `-a1` keys and the second created 6
 * more with `-a2`: twelve calls to three people about one appointment, and a history
 * that no longer replays. The second run reads the coordination the file already holds
 * and hands it back.
 */
test("a second run against a completed ledger creates no call and returns what the first recorded", async () => {
  await withFake(CONFIRMED, async (port, fake) => {
    const request = coordinationRequest();
    const path = ledgerPath();
    const first = await runCoordination({ request, port, ledgerPath: path, pollIntervalMs: 5 });
    assert.equal(first.outcome, "verbally_confirmed");
    assert.equal(fake.created.length, 6, "three gather calls and three confirm calls");
    assert.deepEqual(
      [...new Set(fake.created.map((call) => (call.idempotencyKey ?? "").slice(-3)))],
      ["-a1"],
      "every one of them the first attempt at that call",
    );
    const before = readFileSync(path, "utf8");

    const lines: string[] = [];
    const second = await runCoordination({
      request,
      port,
      ledgerPath: path,
      pollIntervalMs: 5,
      onProgress: (line) => lines.push(line),
    });
    assert.equal(fake.created.length, 6, "the second run created no call at all");
    assert.equal(second.outcome, first.outcome);
    assert.equal(second.slot_id, first.slot_id);
    assert.equal(second.slot_spoken, first.slot_spoken);
    assert.deepEqual(second.confirmed_with, first.confirmed_with);
    assert.deepEqual(second.unreleased, []);
    assert.equal(second.calls_placed, first.calls_placed, "and it claims no call of its own");
    assert.match(second.note, /already records this coordination, so this run placed no call/);
    assert.ok(lines.some((line) => line.includes("nothing was dialled")), lines.join(" | "));
    assert.equal(readFileSync(path, "utf8"), before, "nothing was appended either");
    const verification = replay(readEntries(path));
    assert.equal(verification.ok, true, JSON.stringify(verification.issues));
  });
});

/**
 * The same mistake one step earlier and worse. This run died between the yes and the
 * release call, so two people are owed one. A second run rang all three again and
 * closed the file with a clean `verbally_confirmed` of its own, which wrote that debt
 * out of the history. The refusal points at recovery, which is the path that settles a
 * call under the key it went out under, and that still finishes the job.
 */
test("a second run against an interrupted ledger is refused, and resume finishes it", async () => {
  await withFake(WITH_RELEASES, async (port, fake) => {
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
    const placed = fake.created.length;
    const before = readFileSync(path, "utf8");
    assert.equal(placed, 5, "three gathers and two confirms went out");

    await assert.rejects(
      () => runCoordination({ request, port, ledgerPath: path, pollIntervalMs: 5 }),
      (error: unknown) => {
        assert.ok(error instanceof AlreadyCoordinatedError, `got ${String(error)}`);
        assert.match(error.message, /the run did not finish/);
        assert.match(error.message, /resume --request/);
        assert.match(error.message, /Nothing was dialled\./);
        return true;
      },
    );
    assert.equal(fake.created.length, placed, "so nobody was rung a second time");
    assert.equal(readFileSync(path, "utf8"), before, "and the interrupted history is untouched");

    const resumed = await resumeCoordination({ request, port, ledgerPath: path, pollIntervalMs: 5 });
    assert.equal(resumed.outcome, "not_confirmed");
    assert.deepEqual(resumed.unreleased, [], "both parties who said yes were told");
    assert.deepEqual(
      fake.created.filter((call) => call.phase === "release").map((call) => call.phones[0]),
      [TENANT, PLUMBER],
      "most recent yes first",
    );
    assert.equal(replay(readEntries(path)).ok, true);
  });
});

async function withOwedRelease(
  body: (args: {
    port: CallePort;
    fake: FakeCalle;
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
    await body({ port, fake, path, request });
  } finally {
    await fake.close();
  }
}

/**
 * A round that finished and still owes somebody a call. Nothing left here is a gather
 * or a confirm question, and the one call outstanding is a retry, so `run` places it
 * either way. It says what is outstanding and names the command that may.
 */
test("a finished round that still owes a release call is sent to resume as well", async () => {
  await withOwedRelease(async ({ port, fake, path, request }) => {
    const placed = fake.created.length;
    const before = readFileSync(path, "utf8");
    await assert.rejects(
      () => runCoordination({ request, port, ledgerPath: path, pollIntervalMs: 5 }),
      (error: unknown) => {
        assert.ok(error instanceof AlreadyCoordinatedError, `got ${String(error)}`);
        assert.match(error.message, /not_confirmed with work still outstanding/);
        assert.match(error.message, /plumber is still owed a release call/);
        return true;
      },
    );
    assert.equal(fake.created.length, placed, "nothing was dialled");
    assert.equal(readFileSync(path, "utf8"), before, "and nothing was written");
  });
});

/**
 * The one exception, from both sides.
 *
 * A release call that reached a machine leaves the person owed, so calling again is
 * right. It is also the only call this app places under a key CALL-E has never seen
 * after the fact, which is a handset ringing rather than a lookup, so it is asked for.
 */
test("a release retry nobody asked for is reported as owed rather than placed", async () => {
  await withOwedRelease(async ({ port, fake, path, request }) => {
    const placed = fake.created.length;
    const lines: string[] = [];
    const resumed = await resumeCoordination({
      request,
      port,
      ledgerPath: path,
      pollIntervalMs: 5,
      onProgress: (line) => lines.push(line),
    });
    assert.equal(fake.created.length, placed, "no second call to the plumber");
    assert.deepEqual(resumed.unreleased, ["plumber"], "and the debt is still reported");
    assert.ok(
      lines.some((line) => line.includes("plumber") && line.includes("resume --retry-release")),
      lines.join(" | "),
    );
    assert.equal(replay(readEntries(path)).ok, true, "the round it opened still replays");
  });
});

test("the same ledger with the retry authorized places the second call", async () => {
  await withOwedRelease(async ({ port, fake, path, request }) => {
    const placed = fake.created.length;
    const resumed = await resumeCoordination({
      request,
      port,
      ledgerPath: path,
      pollIntervalMs: 5,
      retryRelease: true,
    });
    assert.equal(fake.created.length, placed + 1, "one more call, the retry");
    const releases = fake.created.filter((call) => call.phase === "release");
    assert.deepEqual(releases.map((call) => call.phones[0]), [PLUMBER, PLUMBER], "the phone rang twice");
    assert.notEqual(releases[0]?.id, releases[1]?.id, "two calls at CALL-E, not one answered twice");
    assert.match(releases[0]?.idempotencyKey ?? "", /-a1$/);
    assert.match(releases[1]?.idempotencyKey ?? "", /-a2$/, "the attempt number made it a new call");
    assert.deepEqual(resumed.unreleased, ["plumber"], "the machine answered that one too");
    assert.equal(replay(readEntries(path)).ok, true);
  });
});

test("a ledger a different request wrote is refused before the first call", async () => {
  await withFake(CONFIRMED, async (port, fake) => {
    const path = ledgerPath();
    await runCoordination({ request: coordinationRequest(), port, ledgerPath: path, pollIntervalMs: 5 });
    const placed = fake.created.length;
    // Only the id is edited here, which is the first thing every key is built from.
    // The digest binds the request whole, so any other edit lands in the same place.
    const other = coordinationRequest({ request_id: "ash-lane-3b-leak-2" });
    await assert.rejects(
      () => runCoordination({ request: other, port, ledgerPath: path, pollIntervalMs: 5 }),
      (error: unknown) => {
        assert.ok(error instanceof AlreadyCoordinatedError, `got ${String(error)}`);
        assert.match(error.message, /written from a different request/);
        return true;
      },
    );
    assert.equal(fake.created.length, placed, "nothing was dialled");
  });
});

/**
 * Half an entry at the end is what a crash during an append leaves, so the run that
 * wrote it stopped there. Reading a ledger drops that line, which is what would have
 * let a second run see a shorter history and append a round to it. `resume` repairs the
 * line, under the lock, which is why the refusal points there.
 */
test("a ledger torn by a crash mid append is refused rather than appended to", async () => {
  await withFake(CONFIRMED, async (port, fake) => {
    const request = coordinationRequest();
    const path = ledgerPath();
    await runCoordination({ request, port, ledgerPath: path, pollIntervalMs: 5 });
    const placed = fake.created.length;
    const text = readFileSync(path, "utf8");
    writeFileSync(path, text.slice(0, text.length - 40));
    await assert.rejects(
      () => runCoordination({ request, port, ledgerPath: path, pollIntervalMs: 5 }),
      (error: unknown) => {
        assert.ok(error instanceof AlreadyCoordinatedError, `got ${String(error)}`);
        assert.match(error.message, /ends in half an entry/);
        assert.match(error.message, /resume --request/);
        return true;
      },
    );
    assert.equal(fake.created.length, placed, "nothing was dialled");
  });
});

const RELEASE_KEY = "mps-ash-lane-3b-leak-release-plumber-thu-14-0123456789ab-a1";

function attemptEntry(
  phase: Phase,
  partyId: string,
  slotId: string | null,
  attempt: number,
  key: string,
): LedgerEntry {
  return {
    kind: "call_attempt",
    at: "2026-08-04T17:00:00.000Z",
    phase,
    party_id: partyId,
    phone_masked: "+14*****01",
    slot_id: slotId,
    attempt,
    idempotency_key: key,
    payload_digest: "sha256:00",
    provider_origin: null,
    provider_account: null,
  };
}

/** A release call that ended and told nobody, which is what leaves the debt owed. */
function releaseEntry(key: string): LedgerEntry {
  const result: CommitResult = {
    party_id: "plumber",
    phone_masked: "+14*****01",
    phase: "release",
    slot_id: "thu-14",
    call_id: "call_fake9",
    provider_call_id: null,
    idempotency_key: key,
    call_status: "completed",
    confirmed: false,
    declined: false,
    acknowledged: false,
    within_window: true,
    window_reason: null,
    completion_time_usable: true,
    question_asked: false,
    reached_person: false,
    machine_answered: true,
    structured_answer: null,
    heard_answer: null,
    disagreement: false,
    confidence: null,
    transcript_excerpt: [],
    failure_code: null,
  };
  return { kind: "release", at: "2026-08-04T17:01:00.000Z", result };
}

/**
 * Being asked for is not the only condition. While an attempt is unaccounted for it may
 * be on the phone to somebody, so that one is settled under the key it went out under
 * rather than a second identity being minted, whoever asked.
 */
test("an authorized retry still waits while an earlier attempt is unaccounted for", async () => {
  const request = coordinationRequest();
  const slot = request.slots[1]!;
  const party = request.parties[0]!;
  const port = stubPort([
    {
      phase: "release",
      phone: PLUMBER,
      userLines: ["Hello?", "Okay, thanks for letting me know."],
      structured: { acknowledged: "yes", notes: "" },
    },
  ]);
  const history: LedgerEntry[] = [attemptEntry("release", party.id, slot.id, 1, RELEASE_KEY)];
  const lines: string[] = [];
  const round = await releaseRound({
    request,
    port,
    slot,
    parties: [party],
    callsPlaced: 0,
    pollIntervalMs: 1,
    now: () => CLOCK,
    progress: (line) => lines.push(line),
    record: (entry) => void history.push(entry),
    history,
    retryAuthorized: true,
  });
  assert.deepEqual(round.unreleased, ["plumber"], "still owed, which is what the report has to say");
  assert.equal(round.callsPlaced, 0, "nothing was charged to the budget");
  assert.equal(port.creates.length, 0, "and nothing was sent");
  assert.ok(lines.some((line) => line.includes("unaccounted for")), lines.join(" | "));
});

/**
 * The rule on its own. Every call that goes out under a key the provider has never
 * seen asks this one function, so this is the whole of it in one place.
 */
test("one gather or confirm call per coordination, a release retry only when it is asked for and settled", () => {
  assert.deepEqual(attemptToMint([], "gather", "plumber", null), { attempt: 1, refusal: null });
  assert.deepEqual(attemptToMint([], "release", "plumber", "thu-14"), { attempt: 1, refusal: null });

  for (const phase of ["gather", "confirm"] as const) {
    const slotId = phase === "confirm" ? "thu-14" : null;
    const held = [attemptEntry(phase, "plumber", slotId, 1, `mps-key-${phase}-a1`)];
    // Authorized, to show that authorizing a retry does not reach these two: there is
    // nothing to retry, the answer to that call is already on disk.
    const verdict = attemptToMint(held, phase, "plumber", slotId, true);
    assert.equal(verdict.attempt, null, `a second ${phase} call was minted`);
    assert.match(verdict.refusal ?? "", new RegExp(`already records a ${phase} call`));
    assert.equal(attemptToMint(held, phase, "tenant", slotId).attempt, 1, "another party is another call");
  }

  const attempted = [attemptEntry("release", "plumber", "thu-14", 1, RELEASE_KEY)];
  const unaccounted = attemptToMint(attempted, "release", "plumber", "thu-14", true);
  assert.equal(unaccounted.attempt, null, "that attempt may still be live");
  assert.match(unaccounted.refusal ?? "", /unaccounted for/);

  const settled = [...attempted, releaseEntry(RELEASE_KEY)];
  const unasked = attemptToMint(settled, "release", "plumber", "thu-14");
  assert.equal(unasked.attempt, null, "a settled attempt is not a licence on its own");
  assert.match(unasked.refusal ?? "", /resume --retry-release/);
  assert.deepEqual(
    attemptToMint(settled, "release", "plumber", "thu-14", true),
    { attempt: 2, refusal: null },
    "asked for and settled is the one case that mints",
  );
});

/**
 * A completed ledger is handed back only when a replay of it supports the outcome it
 * records. These build a genuinely consistent completed ledger with a real run, then
 * edit one entry so the file is still syntactically complete (it has an outcome, no
 * unsettled call, owes no release) but no longer replays. A run pointed at one must
 * refuse rather than hand back a success it cannot stand behind. It must not dial it.
 *
 * Before this the handback checked only for unsettled calls and owed releases, then
 * trusted the closing outcome. So each of these was returned as a coordination that
 * never happened, with nothing on a phone to show for it.
 */

type OutcomeEntry = Extract<LedgerEntry, { kind: "outcome" }>;
type CommitEntry = Extract<LedgerEntry, { kind: "commit" }>;

function tamperLedger(path: string, mutate: (entries: LedgerEntry[]) => void): void {
  const entries = readEntries(path);
  mutate(entries);
  writeFileSync(path, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
}

/**
 * Run a real coordination to a clean verbally_confirmed ledger, confirm it replays,
 * edit it, then run again and expect the edited file to be refused with nothing dialled.
 */
async function completedThenTampered(
  mutate: (entries: LedgerEntry[]) => void,
  check: (message: string) => void,
): Promise<void> {
  await withFake(CONFIRMED, async (port, fake) => {
    const request = coordinationRequest();
    const path = ledgerPath();
    const first = await runCoordination({ request, port, ledgerPath: path, pollIntervalMs: 5 });
    assert.equal(first.outcome, "verbally_confirmed");
    const placed = fake.created.length;
    assert.equal(placed, 6, "three gather calls and three confirm calls");
    assert.equal(replay(readEntries(path)).ok, true, "the ledger replays clean before it is touched");

    tamperLedger(path, mutate);
    assert.equal(replay(readEntries(path)).ok, false, "and the edit is a real inconsistency");
    const before = readFileSync(path, "utf8");

    await assert.rejects(
      () => runCoordination({ request, port, ledgerPath: path, pollIntervalMs: 5 }),
      (error: unknown) => {
        assert.ok(error instanceof AlreadyCoordinatedError, `got ${String(error)}`);
        assert.match(error.message, /a replay of the ledger does not support that/);
        assert.match(error.message, /Nothing was dialled\./);
        check(error.message);
        return true;
      },
    );
    assert.equal(fake.created.length, placed, "nothing was dialled");
    assert.equal(readFileSync(path, "utf8"), before, "and nothing was written");
  });
}

test("a completed ledger claiming verbally_confirmed with a party never credited is refused", async () => {
  await completedThenTampered(
    (entries) => {
      // The superintendent's confirm call is edited to a yes that was never credited,
      // while the outcome still claims all three confirmed. inspectLedger sees a settled
      // call and, on a verbally_confirmed outcome, owes no release, so the old handback
      // trusted it. replay does not: verbally_confirmed needs every party credited.
      const commit = [...entries]
        .reverse()
        .find((entry): entry is CommitEntry => entry.kind === "commit" && entry.result.party_id === "superintendent");
      assert.ok(commit !== undefined, "the ledger has a superintendent confirm call");
      commit.result = { ...commit.result, confirmed: false };
    },
    (message) => assert.match(message, /superintendent never confirmed/),
  );
});

test("a completed ledger whose recorded slot is not the one the answers choose is refused", async () => {
  await completedThenTampered(
    (entries) => {
      // Everyone can do option 2 (thu-14) and that is the slot chosen and confirmed. The
      // outcome is edited to name thu-10, a slot the recorded answers do not land on.
      const outcome = entries.find((entry): entry is OutcomeEntry => entry.kind === "outcome");
      assert.ok(outcome !== undefined, "the ledger has an outcome entry");
      assert.equal(outcome.slot_id, "thu-14", "the real run confirmed thu-14");
      outcome.slot_id = "thu-10";
    },
    (message) => assert.match(message, /confirmed slot thu-10 is not the chosen slot thu-14/),
  );
});

test("a completed ledger whose calls_placed does not match its call entries is refused", async () => {
  await completedThenTampered(
    (entries) => {
      // Six calls are recorded (three gather, three confirm). The outcome is edited to
      // claim five, which no reading of the entries supports.
      const outcome = entries.find((entry): entry is OutcomeEntry => entry.kind === "outcome");
      assert.ok(outcome !== undefined, "the ledger has an outcome entry");
      assert.equal(outcome.calls_placed, 6, "the real run placed six calls");
      outcome.calls_placed = 5;
    },
    (message) => assert.match(message, /calls_placed 5 does not match the 6 call entries/),
  );
});

/**
 * The gather-orphan case, decided on purpose.
 *
 * A gather call attempted with no result behind it is not in inspectLedger's outstanding
 * list: resume never gathers again, so there is nothing it could place to settle one and
 * it is nobody's to finish. That is why the outstanding check lets this ledger through.
 * replay still flags the open attempt, because the call may have been on the phone to
 * somebody, so the outcome the file records cannot be trusted. A completed ledger with a
 * live-looking gather call is refused rather than handed back. Routing it to resume would
 * be wrong (resume cannot re-gather) and returning it would vouch for a coordination a
 * possibly-live call could still change. Fail closed.
 */
test("a completed ledger carrying an unaccounted gather attempt is refused, not handed back", async () => {
  await completedThenTampered(
    (entries) => {
      // A stray gather attempt for the plumber under a key no gather result settles. It
      // reads as a call CALL-E may have accepted with the process dead before the answer
      // landed. inspectLedger files it under unsettledGathers (not unsettled, not owed),
      // so the old handback ignored it.
      const started = entries.findIndex((entry) => entry.kind === "run_started");
      entries.splice(
        started + 1,
        0,
        attemptEntry("gather", "plumber", null, 2, "mps-ash-lane-3b-leak-gather-plumber-orphan-a2"),
      );
    },
    (message) => assert.match(message, /plumber's gather call.*nothing in this ledger settles it/),
  );
});

/**
 * The regression guard for the reading path: a genuinely consistent completed ledger
 * still replays, so it is still handed back with no call placed and the same result. The
 * replay gate refuses inconsistent ledgers without touching this one.
 */
test("a consistent completed ledger still hands back the recorded outcome and dials nobody", async () => {
  await withFake(CONFIRMED, async (port, fake) => {
    const request = coordinationRequest();
    const path = ledgerPath();
    const first = await runCoordination({ request, port, ledgerPath: path, pollIntervalMs: 5 });
    assert.equal(first.outcome, "verbally_confirmed");
    const placed = fake.created.length;
    const before = readFileSync(path, "utf8");

    const second = await runCoordination({ request, port, ledgerPath: path, pollIntervalMs: 5 });
    assert.equal(fake.created.length, placed, "the reading run created no call");
    assert.equal(second.outcome, first.outcome);
    assert.equal(second.slot_id, first.slot_id);
    assert.deepEqual(second.confirmed_with, first.confirmed_with);
    assert.equal(second.calls_placed, first.calls_placed);
    assert.equal(readFileSync(path, "utf8"), before, "and wrote nothing");
  });
});


