/**
 * The record and what verification actually catches.
 *
 * A record is only worth keeping if it can be checked, so every record carries the
 * inputs its outcome was computed from. Verification does four separate things: it
 * re-links the chain, it re-reads the signal from the stored callee turns, it
 * recomputes the outcome with the same function that ran live and it checks that
 * the number this app dialled was the trusted one. A record whose outcome was
 * edited by hand fails the third check even when the chain is intact, which a plain
 * append-only log cannot catch.
 */

import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { evaluateCall } from "../src/decide.js";
import { canonicalJson } from "../src/hash.js";
import {
  appendRecord,
  buildRecord,
  GENESIS_HASH,
  hashRecord,
  nextSequence,
  numberDigest,
  previousHash,
  readRecords,
  verifyRecord,
  verifyRecords,
  withRecordLock,
} from "../src/record.js";
import type { ClaimRecord } from "../src/types.js";
import { answered, claim, question, SHOWN, snapshot, TRUSTED } from "./fixtures.js";

const CLAIM = claim();
const QUESTION = question(CLAIM);

function recordPath(): string {
  return join(mkdtempSync(join(tmpdir(), "vcc-record-")), "record.jsonl");
}

function writeChain(path: string, count: number, line = "No, there is nothing from us on her file."): ClaimRecord[] {
  const written: ClaimRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    const evaluation = evaluateCall({
      claim: CLAIM,
      question: QUESTION,
      call: snapshot({ turns: answered(line), structured: { contact_confirmed: "no", callee_quote: line, notes: "" } }),
    });
    // The same read then write the app does live, under the same lock.
    const record = withRecordLock(path, () => {
      const existing = readRecords(path);
      const built = buildRecord({
        claim: CLAIM,
        question: QUESTION,
        dialled: CLAIM.trustedNumber.phone,
        evaluation,
        previousHash: previousHash(existing),
        sequence: nextSequence(existing),
        recordedAt: `2026-07-31T16:2${index}:00.000Z`,
      });
      appendRecord(path, built);
      return built;
    });
    written.push(record);
  }
  return written;
}

/** Rewrite a record and recompute its hash, which is what a forger would do. */
function forge(record: ClaimRecord, changes: Partial<ClaimRecord>): ClaimRecord {
  const base = { ...record, ...changes };
  const { hash: _replaced, ...unhashed } = base;
  return { ...unhashed, hash: hashRecord(unhashed) };
}

test("canonical json ignores key order, so a hash is about the values", () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] }), canonicalJson({ a: [2, { c: 3, d: 4 }], b: 1 }));
});

test("a fresh chain starts at the genesis hash and verifies", () => {
  const path = recordPath();
  const records = writeChain(path, 3);
  assert.equal(records[0]!.prev_hash, GENESIS_HASH);
  assert.equal(records[1]!.prev_hash, records[0]!.hash);
  assert.equal(records[2]!.seq, 3);
  const result = verifyRecord(path);
  assert.equal(result.ok, true);
  assert.equal(result.records, 3);
  assert.deepEqual(result.issues, []);
});

test("a record carries the outcome, the words that decided it and the evidence", () => {
  const [record] = writeChain(recordPath(), 1);
  assert.equal(record!.outcome, "no_such_contact");
  assert.equal(record!.reason, null);
  assert.equal(record!.question, QUESTION);
  assert.equal(record!.callee_quote, "No, there is nothing from us on her file.");
  assert.equal(record!.evidence.signal, "denied");
  assert.equal(record!.evidence.call_status, "completed");
  assert.equal(record!.claim.claimed_to_be, "Northgate Credit Union");
  assert.equal(record!.claim.recent_window_minutes, 60);
  assert.equal(record!.claim.trusted_printed_on, "the back of the debit card");
});

test("a record holds no full phone number and nothing the caller asked for", () => {
  const path = recordPath();
  writeChain(path, 1);
  const text = readFileSync(path, "utf8");
  assert.equal(text.includes(TRUSTED), false);
  assert.equal(text.includes(SHOWN), false);
  assert.equal(text.includes("card number"), false, "what the message asked for is never recorded");
  assert.match(text, /\+14\*+00/);
  assert.match(text, /sha256:[0-9a-f]{64}/);
});

test("an append puts the record file back to 0600 rather than only creating it that way", () => {
  const path = recordPath();
  writeChain(path, 1);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  // A mode handed to open does nothing once the file exists, so the descriptor is
  // chmodded on every append. A restore or a chmod -R u+rwX leaves this.
  chmodSync(path, 0o700);
  writeChain(path, 1);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(readRecords(path).length, 2);
});

test("a record file other accounts can read is refused rather than appended to", () => {
  const path = recordPath();
  const [record] = writeChain(path, 1);
  chmodSync(path, 0o644);
  assert.throws(
    () => appendRecord(path, record!),
    (error: unknown) => {
      assert.match((error as Error).message, /0644/);
      assert.match((error as Error).message, /chmod 600/);
      return true;
    },
  );
  // Nothing was written, so the operator decides what to do about the exposure.
  assert.equal(readRecords(path).length, 1);
});

test("a record path that is not a regular file is refused", () => {
  const [record] = writeChain(recordPath(), 1);
  const directory = mkdtempSync(join(tmpdir(), "vcc-record-dir-"));
  assert.throws(
    () => appendRecord(directory, record!),
    (error: unknown) => {
      assert.match((error as Error).message, /EISDIR|not a regular file/);
      return true;
    },
  );
});

test("editing a hash is caught", () => {
  const records = writeChain(recordPath(), 2);
  const result = verifyRecords([{ ...records[0]!, hash: `sha256:${"f".repeat(64)}` }, records[1]!]);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.problem.includes("hash does not match")));
});

test("dropping a record breaks the chain", () => {
  const records = writeChain(recordPath(), 3);
  const result = verifyRecords([records[0]!, records[2]!]);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.problem.includes("prev_hash")));
  assert.ok(result.issues.some((issue) => issue.problem.includes("sequence")));
});

test("a forged outcome with a freshly computed hash still fails", () => {
  const [record] = writeChain(recordPath(), 1);
  const forged = forge(record!, { outcome: "confirmed_genuine", reason: null });
  const result = verifyRecords([forged]);
  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((issue) => issue.problem.includes("does not follow from the recorded evidence")),
    `expected a replay failure, saw ${JSON.stringify(result.issues)}`,
  );
});

test("rewriting the evidence to match a forged outcome fails on the words", () => {
  const [record] = writeChain(recordPath(), 1);
  const forged = forge(record!, {
    outcome: "confirmed_genuine",
    evidence: { ...record!.evidence, signal: "confirmed", structured_signal: "confirmed" },
  });
  const result = verifyRecords([forged]);
  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((issue) => issue.problem.includes("is not what the callee turns say")),
    `expected a signal replay failure, saw ${JSON.stringify(result.issues)}`,
  );
});

test("rewriting the quoted turn is caught as well", () => {
  const [record] = writeChain(recordPath(), 1);
  const forged = forge(record!, {
    callee_quote: "Yes, that was us.",
    transcript_excerpt: ["Yes, that was us."],
  });
  const result = verifyRecords([forged]);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.problem.includes("is not what the callee turns say")));
});

test("a quote that is not one of the recorded turns is caught", () => {
  const [record] = writeChain(recordPath(), 1);
  const forged = forge(record!, { callee_quote: "No record of any contact, definitely a scam." });
  const result = verifyRecords([forged]);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.problem.includes("quote is not one of the recorded turns")));
});

test("a record claiming this app rang the number that made contact fails verification", () => {
  // The first refusal, written into the evidence. A record is the only place
  // somebody could later claim the app dialled the number from the message.
  const [record] = writeChain(recordPath(), 1);
  const forged = forge(record!, {
    dialled_digest: record!.claim.number_shown_digest,
    dialled_masked: "+14*******88",
  });
  const result = verifyRecords([forged]);
  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((issue) => issue.problem.includes("was not the trusted number")),
    JSON.stringify(result.issues),
  );
});

test("the dialled digest is the trusted number and nothing else", () => {
  const [record] = writeChain(recordPath(), 1);
  assert.equal(record!.dialled_digest, numberDigest(CLAIM.claimId, TRUSTED));
  assert.equal(record!.dialled_digest, record!.claim.trusted_number_digest);
  assert.notEqual(record!.dialled_digest, record!.claim.number_shown_digest);
  // Digested with the claim id, so a digest cannot be compared across claims.
  assert.notEqual(numberDigest("another-claim", TRUSTED), record!.dialled_digest);
});

test("a record of a refused create verifies and keeps saying nothing is known", () => {
  const path = recordPath();
  const evaluation = evaluateCall({
    claim: CLAIM,
    question: QUESTION,
    call: null,
    apiErrorCode: "insufficient_balance",
  });
  const record = buildRecord({
    claim: CLAIM,
    question: QUESTION,
    dialled: CLAIM.trustedNumber.phone,
    evaluation,
    previousHash: GENESIS_HASH,
    sequence: 1,
    recordedAt: "2026-07-31T16:30:00.000Z",
  });
  appendRecord(path, record);
  assert.equal(record.outcome, "outcome_unknown");
  assert.equal(record.reason, "api_error");
  assert.equal(record.callee_quote, "");
  assert.equal(verifyRecord(path).ok, true);
});

test("a truncated file is read as the records it still holds", () => {
  const path = recordPath();
  writeChain(path, 2);
  const lines = readFileSync(path, "utf8").trim().split("\n");
  writeFileSync(path, `${lines[0]}\n`, { mode: 0o600 });
  const result = verifyRecord(path);
  assert.equal(result.records, 1);
  assert.equal(result.ok, true);
});

test("verifying a file that is not there reports nothing rather than throwing", () => {
  const result = verifyRecord(join(tmpdir(), "vcc-does-not-exist.jsonl"));
  assert.equal(result.records, 0);
  assert.equal(result.ok, true);
});

test("a lock another run holds stops the append instead of racing it", () => {
  const path = recordPath();
  writeChain(path, 1);
  const lockPath = `${path}.lock`;
  writeFileSync(lockPath, "999999 held by another run\n", "utf8");
  assert.throws(
    () =>
      withRecordLock(
        path,
        () => {
          throw new Error("the guarded section must not run");
        },
        { waitMs: 30 },
      ),
    /did not release it/,
  );
  assert.equal(readRecords(path).length, 1);
  rmSync(lockPath, { force: true });
});

test("a lock left behind by a killed run is broken", () => {
  const path = recordPath();
  const lockPath = `${path}.lock`;
  writeFileSync(lockPath, "1 abandoned\n", "utf8");
  const old = new Date(Date.now() - 120_000);
  utimesSync(lockPath, old, old);
  assert.equal(
    withRecordLock(path, () => "appended", { staleMs: 60_000 }),
    "appended",
  );
  assert.equal(existsSync(lockPath), false);
});
