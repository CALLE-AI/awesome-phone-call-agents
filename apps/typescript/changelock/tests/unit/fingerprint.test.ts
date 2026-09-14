import { describe, expect, it } from "vitest";
import {
  computeRequestHash,
  idempotencyKeyFor,
  phoneFingerprint,
  changeFingerprint,
  generateSafeCaseCode,
} from "../../src/domain/fingerprint";

const base = {
  caseId: "case-1",
  trustedContactId: "tc-1",
  taskVersion: "task_v1",
  schemaVersion: "recipient_result_v1",
  taskText: "task text",
  destinationFingerprint: phoneFingerprint("+12025550114"),
};

describe("request fingerprint / idempotency key", () => {
  it("produces a stable key for identical intent", () => {
    const h1 = computeRequestHash(base);
    const h2 = computeRequestHash({ ...base });
    expect(h1).toBe(h2);
    expect(idempotencyKeyFor(h1)).toBe(idempotencyKeyFor(h2));
    expect(idempotencyKeyFor(h1)).toMatch(/^cl-[0-9a-f]{16,}$/);
  });

  it("changes when any call-defining field changes", () => {
    const h = computeRequestHash(base);
    const variants: Partial<typeof base>[] = [
      { caseId: "case-2" },
      { trustedContactId: "tc-2" },
      { taskVersion: "task_v2" },
      { schemaVersion: "recipient_result_v2" },
      { taskText: "task text!" },
      { destinationFingerprint: phoneFingerprint("+12025550127") },
    ];
    for (const v of variants) {
      expect(computeRequestHash({ ...base, ...v })).not.toBe(h);
    }
  });

  it("is deterministic regardless of property order", () => {
    const a = computeRequestHash(base);
    const reordered = Object.fromEntries(Object.entries(base).reverse()) as typeof base;
    expect(computeRequestHash(reordered)).toBe(a);
  });
});

describe("phoneFingerprint", () => {
  it("is a sha256 hex digest, not the phone", () => {
    const fp = phoneFingerprint("+12025550114");
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(fp).not.toContain("2025550114");
  });
});

describe("changeFingerprint", () => {
  it("binds vendor and destination descriptor", () => {
    const a = changeFingerprint({ vendorId: "v1", destinationDescriptor: "bank ...4410" });
    const b = changeFingerprint({ vendorId: "v1", destinationDescriptor: "bank ...4410" });
    const c = changeFingerprint({ vendorId: "v2", destinationDescriptor: "bank ...4410" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("generateSafeCaseCode", () => {
  it("produces CL-XXXXXX hex codes", () => {
    for (let i = 0; i < 20; i++) {
      expect(generateSafeCaseCode()).toMatch(/^CL-[0-9A-F]{6}$/);
    }
  });
});
