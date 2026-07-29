import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
    const existing = readRecords(path);
    const record = buildRecord({
      request,
      attempts: [attempt],
      verdict: "approved",
      reason: null,
      approvedBy: ["alice"],
      previousHash: previousHash(existing),
      sequence: nextSequence(existing),
      recordedAt: `2026-07-29T10:0${index}:00Z`,
    });
    appendRecord(path, record);
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
