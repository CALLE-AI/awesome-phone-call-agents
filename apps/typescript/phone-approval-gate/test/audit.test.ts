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
import {
  GENESIS_HASH,
  appendRecord,
  buildRecord,
  canonicalJson,
  hashRecord,
  nextSequence,
  previousHash,
  readRecords,
  verifyAudit,
  verifyRecords,
  withAuditLock,
} from "../src/audit.js";
import { evaluateAttempt } from "../src/decide.js";
import type { AuditRecord, CallSnapshot } from "../src/types.js";
import { approvalRequest, FIXED_SECRET } from "./fixtures.js";

function approvedCall(): CallSnapshot {
  return {
    id: "call_audit1",
    status: "completed",
    recipients: [
      {
        id: "rcp_1",
        phones: ["+14155550100"],
        status: "completed",
        structuredResult: { decision: "approve", spoken_code: "472913", reason: "Said approve." },
        summary: "Approved.",
        attempts: [
          {
            id: "att_1",
            phone: "+14155550100",
            status: "completed",
            startedAt: "2026-07-29T10:00:05Z",
            completedAt: "2026-07-29T10:01:00Z",
            summary: null,
            transcriptTurns: [
              { offset_seconds: 0, speaker: "bot", text: "Decision please." },
              { offset_seconds: 6, speaker: "user", text: "Four seven two nine one three, I approve." },
            ],
            providerCallId: "provider_1",
            failureCode: null,
            failureMessage: null,
          },
        ],
      },
    ],
    structuredResult: { decision: "approve", spoken_code: "472913", reason: "Said approve." },
    summary: "Approved.",
    taskCompleted: true,
    completionConfidence: { score: 0.94, label: "high" },
    evidence: ["The person read the code back."],
    failureCode: null,
    failureMessage: null,
    createdAt: "2026-07-29T10:00:00Z",
    completedAt: "2026-07-29T10:01:00Z",
  };
}

function writeChain(path: string, count: number): AuditRecord[] {
  const request = approvalRequest();
  const written: AuditRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    const attempt = evaluateAttempt({
      request,
      approver: request.approvers[0]!,
      call: approvedCall(),
      code: FIXED_SECRET.code,
      phrase: FIXED_SECRET.phrase,
    });
    // The same read then write the gate does, under the same lock.
    const record = withAuditLock(path, () => {
      const existing = readRecords(path);
      const built = buildRecord({
        request,
        attempts: [attempt],
        verdict: "approved",
        reason: null,
        approvedBy: ["alice"],
        previousHash: previousHash(existing),
        sequence: nextSequence(existing),
        recordedAt: `2026-07-29T10:0${index}:00Z`,
      });
      appendRecord(path, built);
      return built;
    });
    written.push(record);
  }
  return written;
}

function tempAudit(): string {
  return join(mkdtempSync(join(tmpdir(), "pag-audit-")), "audit.jsonl");
}

test("canonical json ignores key order", () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] }), canonicalJson({ a: [2, { c: 3, d: 4 }], b: 1 }));
});

test("a fresh chain starts at the genesis hash and verifies", () => {
  const path = tempAudit();
  const records = writeChain(path, 3);
  assert.equal(records[0]!.prev_hash, GENESIS_HASH);
  assert.equal(records[1]!.prev_hash, records[0]!.hash);
  const result = verifyAudit(path);
  assert.equal(result.ok, true);
  assert.equal(result.records, 3);
  assert.deepEqual(result.issues, []);
});

test("records keep the code out of the file", () => {
  const path = tempAudit();
  writeChain(path, 1);
  const text = readFileSync(path, "utf8");
  assert.equal(text.includes(FIXED_SECRET.code), false);
  assert.match(text, /sha256:[0-9a-f]{64}/);
});

test("an append puts the record file back to 0600, not only a create", () => {
  const path = tempAudit();
  writeChain(path, 1);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  // What an operator with a loose umask, a restored backup or a chmod -R leaves
  // behind. The mode handed to open does nothing once the file exists.
  chmodSync(path, 0o644);
  writeChain(path, 1);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(readRecords(path).length, 2);
});

test("a record file that is not a regular file is refused", () => {
  const [record] = writeChain(tempAudit(), 1);
  const directory = mkdtempSync(join(tmpdir(), "pag-audit-dir-"));
  assert.throws(
    () => appendRecord(directory, record!),
    (error: unknown) => {
      assert.match((error as Error).message, /EISDIR|not a regular file/);
      return true;
    },
  );
});

test("editing a hash is caught", () => {
  const path = tempAudit();
  const records = writeChain(path, 2);
  const tampered = [{ ...records[0]!, hash: `sha256:${"f".repeat(64)}` }, records[1]!];
  const result = verifyRecords(tampered);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.problem.includes("hash does not match")));
});

test("dropping a record breaks the chain", () => {
  const path = tempAudit();
  const records = writeChain(path, 3);
  const result = verifyRecords([records[0]!, records[2]!]);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.problem.includes("prev_hash")));
});

test("a forged verdict with a freshly computed hash still fails", () => {
  const path = tempAudit();
  const records = writeChain(path, 1);
  const rejectedAttempt = {
    ...records[0]!.attempts[0]!,
    outcome: "not_approved" as const,
    reason: "code_mismatch" as const,
    evidence: { ...records[0]!.attempts[0]!.evidence, code_match: false },
    spoken_secret_digest: "sha256:deadbeef",
  };
  const forgedBase = {
    ...records[0]!,
    attempts: [rejectedAttempt],
    verdict: "approved" as const,
    approved_by: ["alice"],
  };
  const { hash: _ignored, ...unhashed } = forgedBase;
  const forged: AuditRecord = { ...unhashed, hash: hashRecord(unhashed) };
  const result = verifyRecords([forged]);
  assert.equal(result.ok, false);
  assert.ok(
    result.issues.some((issue) => issue.problem.includes("does not follow from the recorded")),
    `expected a re-derivation failure, saw ${JSON.stringify(result.issues)}`,
  );
});

test("claiming a code matched when the digests disagree is caught", () => {
  const path = tempAudit();
  const records = writeChain(path, 1);
  const attempt = { ...records[0]!.attempts[0]!, spoken_secret_digest: "sha256:00" };
  const base = { ...records[0]!, attempts: [attempt] };
  const { hash: _ignored, ...unhashed } = base;
  const result = verifyRecords([{ ...unhashed, hash: hashRecord(unhashed) }]);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.problem.includes("code_match")));
});

test("rewriting the excerpt to say approve is caught", () => {
  const path = tempAudit();
  const records = writeChain(path, 1);
  const attempt = { ...records[0]!.attempts[0]!, transcript_excerpt: ["[code] reject that"] };
  const base = { ...records[0]!, attempts: [attempt] };
  const { hash: _ignored, ...unhashed } = base;
  const result = verifyRecords([{ ...unhashed, hash: hashRecord(unhashed) }]);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.problem.includes("is not what the excerpt says")));
});

test("a truncated file is read as the records it still holds", () => {
  const path = tempAudit();
  writeChain(path, 2);
  const lines = readFileSync(path, "utf8").trim().split("\n");
  writeFileSync(path, `${lines[0]}\n`);
  const result = verifyAudit(path);
  assert.equal(result.records, 1);
  assert.equal(result.ok, true);
});

test("verifying a missing file reports zero records rather than throwing", () => {
  const result = verifyAudit(join(tmpdir(), "pag-does-not-exist.jsonl"));
  assert.equal(result.records, 0);
  assert.equal(result.ok, true);
});

function noCallRecord(options: { apiErrorCode: string; unknown: boolean }): AuditRecord {
  const request = approvalRequest();
  const attempt = evaluateAttempt({
    request,
    approver: request.approvers[0]!,
    call: null,
    code: FIXED_SECRET.code,
    phrase: FIXED_SECRET.phrase,
    apiErrorCode: options.apiErrorCode,
    ...(options.unknown ? { callStateUnknown: true, callId: "call_maybe" } : {}),
  });
  return buildRecord({
    request,
    attempts: [attempt],
    verdict: "not_approved",
    reason: attempt.reason,
    approvedBy: [],
    previousHash: GENESIS_HASH,
    sequence: 1,
    recordedAt: "2026-07-30T10:00:00.000Z",
  });
}

test("a record of a refused call verifies, because its outcome replays", () => {
  const record = noCallRecord({ apiErrorCode: "insufficient_balance", unknown: false });
  assert.equal(record.attempts[0]!.evidence.call_status, "api_error");
  const result = verifyRecords([record]);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("a record of an unknown call state verifies and keeps saying unknown", () => {
  const record = noCallRecord({ apiErrorCode: "service_unavailable", unknown: true });
  assert.equal(record.reason, "call_state_unknown");
  assert.equal(record.attempts[0]!.evidence.call_status, "state_unknown");
  assert.equal(record.attempts[0]!.call_id, "call_maybe");
  assert.equal(verifyRecords([record]).ok, true);
});

test("a lock another run holds stops the append instead of racing it", () => {
  const path = tempAudit();
  writeChain(path, 1);
  const lockPath = `${path}.lock`;
  writeFileSync(lockPath, "999999 held by another run\n", "utf8");
  assert.throws(
    () =>
      withAuditLock(
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
  const path = tempAudit();
  const lockPath = `${path}.lock`;
  writeFileSync(lockPath, "1 abandoned\n", "utf8");
  const old = new Date(Date.now() - 120_000);
  utimesSync(lockPath, old, old);
  assert.equal(
    withAuditLock(path, () => "appended", { staleMs: 60_000 }),
    "appended",
  );
  assert.equal(existsSync(lockPath), false);
});
