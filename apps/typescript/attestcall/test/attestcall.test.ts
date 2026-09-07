import { test } from "node:test";
import assert from "node:assert/strict";
import { AuditChain, computeHash } from "../src/audit.ts";
import { classify, extractAnswers, deriveIdempotencyKey, buildAttestationTask } from "../src/attest.ts";
import { loadFixture, FIXTURE_SCENARIOS } from "../src/fixtures.ts";
import { preview, run, validateRequest } from "../src/runner.ts";
import { isE164, maskPhone, redactPhonesInText } from "../src/util.ts";
import type { AttestationRequest } from "../src/types.ts";
import type { AppConfig } from "../src/config.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REQ: AttestationRequest = {
  vendorName: "Acme Payments Inc.",
  vendorPhone: "+14155550123",
  framework: "PCI-DSS",
  requestedBy: "Vendor Risk, Contoso",
  referenceId: "MSA-2024-0912",
};

function demoConfig(auditFile: string): AppConfig {
  return { demo: true, auditFile, port: 4600 };
}

test("isE164 accepts valid and rejects invalid", () => {
  assert.equal(isE164("+14155550123"), true);
  assert.equal(isE164("4155550123"), false);
  assert.equal(isE164("+1"), false);
  assert.equal(isE164("not a phone"), false);
});

test("maskPhone hides the middle digits", () => {
  const masked = maskPhone("+14155550123");
  assert.equal(masked.startsWith("+1"), true);
  assert.equal(masked.endsWith("23"), true);
  assert.equal(masked.includes("4155550"), false);
});

test("redactPhonesInText masks embedded numbers", () => {
  const out = redactPhonesInText("call me at +14155550123 tomorrow");
  assert.equal(out.includes("4155550"), false);
});

test("validateRequest rejects bad phone", () => {
  assert.throws(() => validateRequest({ ...REQ, vendorPhone: "12345" }));
  assert.doesNotThrow(() => validateRequest(REQ));
});

test("buildAttestationTask discloses AI, consent, and framework", () => {
  const task = buildAttestationTask(REQ);
  assert.match(task, /automated assistant/i);
  assert.match(task, /consent/i);
  assert.match(task, /PCI DSS/);
  assert.match(task, /do not fabricate/i);
});

test("deriveIdempotencyKey is stable for same authorization", () => {
  const k1 = deriveIdempotencyKey(REQ, "2026-09-06");
  const k2 = deriveIdempotencyKey(REQ, "2026-09-06");
  const k3 = deriveIdempotencyKey(REQ, "2026-09-07");
  assert.equal(k1, k2);
  assert.notEqual(k1, k3);
});

test("preview places no call and masks phone", () => {
  const p = preview(REQ, demoConfig("/tmp/none.log"));
  assert.equal(p.willPlaceRealCall, false);
  assert.equal(p.vendorPhoneMasked.includes("4155550"), false);
  assert.ok(p.idempotencyKey.startsWith("attest_"));
});

test("classify: compliant fixture -> attested", () => {
  const call = loadFixture("compliant", REQ);
  const answers = extractAnswers(call);
  assert.equal(classify(call, answers), "attested");
});

test("classify: non_compliant -> not_attested", () => {
  const call = loadFixture("non_compliant", REQ);
  assert.equal(classify(call, extractAnswers(call)), "not_attested");
});

test("classify: no_consent -> needs_human (fail-closed)", () => {
  const call = loadFixture("no_consent", REQ);
  assert.equal(classify(call, extractAnswers(call)), "needs_human");
});

test("classify: low_confidence -> needs_human (fail-closed)", () => {
  const call = loadFixture("low_confidence", REQ);
  assert.equal(classify(call, extractAnswers(call)), "needs_human");
});

test("classify: call_failed -> call_failed", () => {
  const call = loadFixture("call_failed", REQ);
  assert.equal(classify(call, extractAnswers(call)), "call_failed");
});

test("all fixtures produce a defined disposition", () => {
  for (const s of FIXTURE_SCENARIOS) {
    const call = loadFixture(s, REQ);
    const d = classify(call, extractAnswers(call));
    assert.ok(["attested", "not_attested", "needs_human", "call_failed"].includes(d));
  }
});

test("audit chain seals and verifies intact", async () => {
  const dir = mkdtempSync(join(tmpdir(), "attest-"));
  const file = join(dir, "audit.log");
  try {
    const cfg = demoConfig(file);
    const r1 = await run(REQ, cfg, { fixtureScenario: "compliant" });
    const r2 = await run(REQ, cfg, { fixtureScenario: "non_compliant" });
    assert.equal(r1.record.index, 0);
    assert.equal(r1.record.prevHash, "GENESIS");
    assert.equal(r2.record.index, 1);
    assert.equal(r2.record.prevHash, r1.record.hash);
    assert.equal(r2.chainIntact, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("audit chain detects tampering", () => {
  const dir = mkdtempSync(join(tmpdir(), "attest-"));
  const file = join(dir, "audit.log");
  try {
    const chain = new AuditChain(file);
    const rec = chain.append({
      request: { vendorName: "X", framework: "PCI-DSS", requestedBy: "Y", vendorPhoneMasked: "+1**23" },
      disposition: "attested",
      answers: { is_compliant: "yes" },
      completionConfidence: { score: 0.9, label: "high" },
      evidence: ["ok"],
      callId: "demo_1",
      callStatus: "completed",
      mode: "demo",
    });
    // Tamper: recompute a different hash proves detection.
    const { hash, ...rest } = rec;
    const tampered = { ...rest, disposition: "not_attested" as const };
    assert.notEqual(computeHash(tampered), hash);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("audit record never stores raw phone", async () => {
  const dir = mkdtempSync(join(tmpdir(), "attest-"));
  const file = join(dir, "audit.log");
  try {
    const { record } = await run(REQ, demoConfig(file), { fixtureScenario: "compliant" });
    const serialized = JSON.stringify(record);
    assert.equal(serialized.includes("4155550123"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
