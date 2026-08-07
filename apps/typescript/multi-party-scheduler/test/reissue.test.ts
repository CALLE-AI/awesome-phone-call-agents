/**
 * What has to still hold before a recorded idempotency key goes back on the wire.
 *
 * Recovery re-issues the key the ledger recorded rather than deriving one. That is
 * what stops a second phone ringing and it also means nothing about that key is
 * recomputed, so nothing about it is checked unless the ledger is read. Three things
 * have to hold. The words behind the key: a key CALL-E never received places whatever
 * body is sent under it, so an upgraded call script would ring somebody with words
 * nobody approved. The provider and the account: a key only names that call inside
 * one namespace, so re-issuing it elsewhere creates the call there and leaves the
 * original open. And the attempt: a new one is only minted once the last one's
 * outcome is known.
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { type CallePort, createSdkPort } from "../src/calle.js";
import { releaseRound, runCoordination } from "../src/coordinate.js";
import { readEntries } from "../src/ledger.js";
import { resumeCoordination } from "../src/resume.js";
import type { LedgerEntry } from "../src/types.js";
import { startFakeCalle, type FakeScript } from "../fake/calle-server.js";
import { coordinationRequest, PLUMBER, SUPER, TENANT } from "./fixtures.js";
import { CalleCallError, stubPort, type StubScript } from "./stub.js";

/** 10am Pacific, which is when every stub call says it finished. */
const CLOCK = Date.parse("2026-08-04T17:00:00Z");

function ledgerPath(): string {
  return join(mkdtempSync(join(tmpdir(), "mps-reissue-")), "ledger.jsonl");
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

const FULL_RUN: FakeScript[] = [
  gather(PLUMBER),
  gather(TENANT),
  gather(SUPER),
  confirmYes(PLUMBER),
  confirmYes(TENANT),
  confirmYes(SUPER),
  releaseOk(PLUMBER),
  releaseOk(TENANT),
];

interface Crashed {
  fake: Awaited<ReturnType<typeof startFakeCalle>>;
  port: CallePort;
  path: string;
  request: ReturnType<typeof coordinationRequest>;
  /** The attempt record for the superintendent's confirm call, the one left open. */
  attempt: LedgerEntry & { kind: "call_attempt" };
  lines: string[];
}

/**
 * A ledger cut in the window inside `placeCall`.
 *
 * A real coordination runs against the fake server and the file is cut straight
 * after the line written before the superintendent's confirm create. So the call
 * really is at the provider under the key that line names, with nothing on disk
 * saying what it did, which is the only state where a key has to be re-issued.
 */
async function crashedAtConfirm(): Promise<Crashed> {
  const fake = await startFakeCalle(FULL_RUN);
  const port = await createSdkPort({ apiKey: "calle_test_key", baseUrl: fake.baseUrl });
  const request = coordinationRequest();
  const path = ledgerPath();
  await runCoordination({ request, port, ledgerPath: path, pollIntervalMs: 5 });
  const entries = readEntries(path);
  const cut = entries.findIndex(
    (entry) => entry.kind === "call_attempt" && entry.phase === "confirm" && entry.party_id === "superintendent",
  );
  assert.notEqual(cut, -1, "placeCall records the attempt before the create");
  const kept = entries.slice(0, cut + 1);
  writeFileSync(path, `${kept.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  const attempt = kept.at(-1);
  assert.ok(attempt !== undefined && attempt.kind === "call_attempt");
  return { fake, port, path, request, attempt, lines: [] };
}

function rewrite(path: string, entries: LedgerEntry[]): void {
  writeFileSync(path, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
}

/**
 * The upgrade case. `payload_digest` was recorded from the first attempt and never
 * read again, so the only thing standing between a changed call script and a live
 * call was whether CALL-E happened to know the key. It knows it when the first
 * request landed and answers with the old call. When the first request never landed
 * the key is new there, so the create succeeds and the person hears whatever this
 * build now says. Editing the recorded digest is how a build with different words
 * behind that key looks from the ledger's side.
 */
test("a key whose payload no longer matches is refused rather than re-issued", async () => {
  const { fake, port, path, request, attempt } = await crashedAtConfirm();
  try {
    const placed = fake.created.length;
    rewrite(
      path,
      readEntries(path).map((entry) =>
        entry.kind === "call_attempt" && entry.idempotency_key === attempt.idempotency_key
          ? { ...entry, payload_digest: "sha256:00000000000000000000000000000000000000000000000000000000000000ff" }
          : entry,
      ),
    );
    const lines: string[] = [];
    const resumed = await resumeCoordination({
      request,
      port,
      ledgerPath: path,
      pollIntervalMs: 5,
      onProgress: (line) => lines.push(line),
    });
    const since = fake.created.slice(placed);
    assert.equal(
      since.some((call) => call.idempotencyKey === attempt.idempotency_key),
      false,
      "the recorded key never went back on the wire",
    );
    assert.equal(
      since.some((call) => call.phase === "confirm"),
      false,
      "and no fourth confirm call was created",
    );
    assert.ok(
      lines.some((line) => line.includes("superintendent") && line.includes("words nobody approved")),
      lines.join(" | "),
    );
    assert.match(resumed.note, /still unsettled, check by hand: superintendent/);
    // The two who said yes are still told. Refusing one call is not an excuse to
    // drop the duty the rest of the ledger records.
    assert.deepEqual(
      since.map((call) => `${call.phase}:${String(call.phones[0])}`),
      [`release:${TENANT}`, `release:${PLUMBER}`],
      "two release calls and nothing else",
    );
  } finally {
    await fake.close();
  }
});

/**
 * A key means that call inside one provider. Resume it against another origin and
 * the create is not a reconciliation at all: it is a new call there, while the
 * original stays ambiguous at the provider it was placed with. That is two calls to
 * one person, wearing the look of recovery. `--base-url` or `CALLE_BASE_URL` on the
 * resume is all it takes, so the origin is recorded beside every key.
 */
test("a ledger resumed against another provider origin will not re-issue its keys", async () => {
  const { fake, port, path, request, attempt } = await crashedAtConfirm();
  const elsewhere = await startFakeCalle(FULL_RUN);
  try {
    const other = await createSdkPort({ apiKey: "calle_test_key", baseUrl: elsewhere.baseUrl });
    assert.notEqual(port.origin, other.origin, "two servers, two origins");
    assert.equal(port.account, other.account, "and the same credential, so only the origin moved");
    const lines: string[] = [];
    const resumed = await resumeCoordination({
      request,
      port: other,
      ledgerPath: path,
      pollIntervalMs: 5,
      onProgress: (line) => lines.push(line),
    });
    assert.equal(
      elsewhere.created.some((call) => call.idempotencyKey === attempt.idempotency_key),
      false,
      "the key was never sent to the other provider",
    );
    assert.equal(
      elsewhere.created.some((call) => call.phase === "confirm"),
      false,
      "so no confirm call was created there",
    );
    assert.ok(
      lines.some((line) => line.includes("superintendent") && line.includes("this run is talking to")),
      lines.join(" | "),
    );
    assert.match(resumed.note, /still unsettled, check by hand: superintendent/);
  } finally {
    await elsewhere.close();
    await fake.close();
  }
});

/**
 * The same host is not the same namespace. Idempotency is scoped to the account, so
 * a resume with another `CALLE_API_KEY` creates the call under that account while
 * the original stays open under the first. The ledger holds a digest of the key it
 * used, never the key.
 */
test("a ledger resumed as another account will not re-issue its keys", async () => {
  const { fake, port, path, request, attempt } = await crashedAtConfirm();
  try {
    const other = await createSdkPort({ apiKey: "calle_another_key", baseUrl: fake.baseUrl });
    assert.equal(port.origin, other.origin, "the same server");
    assert.notEqual(port.account, other.account, "and a different credential");
    assert.equal(
      (other.account ?? "").includes("calle_another_key"),
      false,
      "the fingerprint is a digest, not the key",
    );
    const placed = fake.created.length;
    const lines: string[] = [];
    const resumed = await resumeCoordination({
      request,
      port: other,
      ledgerPath: path,
      pollIntervalMs: 5,
      onProgress: (line) => lines.push(line),
    });
    const since = fake.created.slice(placed);
    assert.equal(
      since.some((call) => call.idempotencyKey === attempt.idempotency_key),
      false,
      "the key was never re-issued under another account",
    );
    assert.ok(
      lines.some((line) => line.includes("superintendent") && line.includes("another account")),
      lines.join(" | "),
    );
    assert.match(resumed.note, /still unsettled, check by hand: superintendent/);
  } finally {
    await fake.close();
  }
});

/**
 * A key on disk with nothing behind it. Only a ledger written before attempts were
 * recorded looks like this and there is nothing in it to check the payload or the
 * provider against, so it is named for a person rather than sent.
 */
test("a key with no attempt record behind it is refused", async () => {
  const { fake, port, path, request, attempt } = await crashedAtConfirm();
  try {
    const placed = fake.created.length;
    // The commit entry keeps the key. The attempt record it came from is gone, which
    // is exactly the shape of a ledger from a build that never wrote one.
    rewrite(path, [
      ...readEntries(path).filter(
        (entry) => !(entry.kind === "call_attempt" && entry.idempotency_key === attempt.idempotency_key),
      ),
      {
        kind: "commit",
        at: attempt.at,
        result: {
          party_id: "superintendent",
          phone_masked: attempt.phone_masked,
          phase: "confirm",
          slot_id: attempt.slot_id ?? "",
          call_id: null,
          provider_call_id: null,
          idempotency_key: attempt.idempotency_key,
          call_status: "unresolved",
          confirmed: false,
          declined: false,
          acknowledged: false,
          within_window: false,
          window_reason: null,
          completion_time_usable: false,
          question_asked: false,
          reached_person: false,
          machine_answered: false,
          structured_answer: null,
          heard_answer: null,
          disagreement: false,
          confidence: null,
          transcript_excerpt: [],
          failure_code: "connection_error",
        },
      },
    ]);
    const lines: string[] = [];
    const resumed = await resumeCoordination({
      request,
      port,
      ledgerPath: path,
      pollIntervalMs: 5,
      onProgress: (line) => lines.push(line),
    });
    const since = fake.created.slice(placed);
    assert.equal(
      since.some((call) => call.idempotencyKey === attempt.idempotency_key),
      false,
      "nothing vouches for that key, so it is not sent",
    );
    assert.ok(
      lines.some((line) => line.includes("superintendent") && line.includes("no attempt record behind it")),
      lines.join(" | "),
    );
    assert.match(resumed.note, /still unsettled, check by hand: superintendent/);
  } finally {
    await fake.close();
  }
});

function stubGather(phone: string): StubScript {
  return {
    phase: "gather",
    phone,
    userLines: ["Hello?", "Option two works."],
    structured: { available_options: [2], none_work: "no", notes: "" },
  };
}

function stubConfirm(phone: string, answer: "confirm" | "decline"): StubScript {
  return {
    phase: "confirm",
    phone,
    userLines: ["Speaking.", answer === "confirm" ? "Confirm, see you then." : "Sorry, I cannot make that."],
    structured: { answer, notes: "" },
  };
}

function stubRelease(phone: string, extra: Partial<StubScript> = {}): StubScript {
  return {
    phase: "release",
    phone,
    userLines: ["Hello?", "Okay, thanks for letting me know."],
    structured: { acknowledged: "yes", notes: "" },
    ...extra,
  };
}

/**
 * The other half of the attempt rule. A retry is only new once the last outcome is
 * known, so an attempt nobody can account for is reconciled under the key it went out
 * under. Minting a second identity there would place a call to somebody who may be on
 * the first one, which is the one thing this protocol exists to prevent.
 */
test("an attempt nobody can account for is reconciled under its own key, never retried", async () => {
  const noReply = (): CalleCallError => new CalleCallError("connection_error", "no answer to the create", null);
  const path = ledgerPath();
  const request = coordinationRequest();
  const first = stubPort([
    stubGather(PLUMBER),
    stubGather(TENANT),
    stubGather(SUPER),
    stubConfirm(PLUMBER, "confirm"),
    stubConfirm(TENANT, "decline"),
    stubRelease(PLUMBER, { createErrors: [noReply(), noReply()] }),
  ]);
  const started = await runCoordination({
    request,
    port: first,
    ledgerPath: path,
    pollIntervalMs: 1,
    now: () => CLOCK,
  });
  assert.deepEqual(started.unreleased, ["plumber"], "the release create was never answered");
  const release = readEntries(path).find((entry) => entry.kind === "release");
  assert.ok(release !== undefined && release.kind === "release");
  assert.equal(release.result.call_id, null, "so no call id ever came back");
  const key = release.result.idempotency_key;
  assert.match(key ?? "", /-a1$/);

  const settled = stubPort([
    stubGather(PLUMBER),
    stubGather(TENANT),
    stubGather(SUPER),
    stubConfirm(PLUMBER, "confirm"),
    stubConfirm(TENANT, "decline"),
    stubRelease(PLUMBER),
  ]);
  const resumed = await resumeCoordination({
    request,
    port: settled,
    ledgerPath: path,
    pollIntervalMs: 1,
    now: () => CLOCK,
  });
  assert.deepEqual(
    settled.creates.map((call) => call.key),
    [key],
    "one create, under the key the unaccounted attempt went out with",
  );
  assert.equal(
    settled.creates.some((call) => call.key.endsWith("-a2")),
    false,
    "no second identity was minted while that attempt was open",
  );
  assert.deepEqual(resumed.unreleased, [], "and the reconciled call reached them");
});

/**
 * The round enforces the rule itself rather than trusting its callers, because both
 * a fresh coordination and a resume place release calls and only one of them reads
 * the ledger first.
 */
test("a release round leaves a party owed while an earlier attempt is unaccounted for", async () => {
  const request = coordinationRequest();
  const slot = request.slots[1]!;
  const party = request.parties[0]!;
  const port = stubPort([stubRelease(PLUMBER)]);
  const history: LedgerEntry[] = [
    {
      kind: "call_attempt",
      at: "2026-08-04T17:00:00.000Z",
      phase: "release",
      party_id: party.id,
      phone_masked: "+14*****01",
      slot_id: slot.id,
      attempt: 1,
      idempotency_key: "mps-ash-lane-3b-leak-release-plumber-thu-14-0123456789ab-a1",
      payload_digest: "sha256:00",
      provider_origin: null,
      provider_account: null,
    },
  ];
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
  });
  assert.deepEqual(round.unreleased, ["plumber"], "still owed, which is what the report has to say");
  assert.equal(round.callsPlaced, 0, "and nothing was charged to the budget");
  assert.equal(port.creates.length, 0, "no second call while the first may be live");
  assert.ok(
    lines.some((line) => line.includes("plumber") && line.includes("unaccounted for")),
    lines.join(" | "),
  );
});
