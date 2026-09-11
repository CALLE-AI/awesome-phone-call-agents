import { describe, expect, it } from "vitest";

import {
  createPhoneProtectionKeys,
  maskPhoneNumber,
  protectPhoneNumber,
  revealPhoneNumber,
} from "@/security/phone-protection";

const dataKey = Buffer.alloc(32, 1).toString("base64");
const lookupKey = Buffer.alloc(32, 2).toString("base64");

describe("phone protection", () => {
  it("encrypts E.164 data and reveals it only with the matching key version", () => {
    const keys = createPhoneProtectionKeys(dataKey, lookupKey, "test-v1");
    const protectedPhone = protectPhoneNumber("+12025550142", keys);

    expect(protectedPhone.phoneE164Ciphertext).not.toContain("12025550142");
    expect(protectedPhone.phoneLookupHash).toHaveLength(64);
    expect(protectedPhone.phoneMasked).toBe("+*******0142");
    expect(revealPhoneNumber(protectedPhone, keys)).toBe("+12025550142");
  });

  it("uses a fresh IV while preserving a stable keyed lookup hash", () => {
    const keys = createPhoneProtectionKeys(dataKey, lookupKey);
    const first = protectPhoneNumber("+12025550142", keys);
    const second = protectPhoneNumber("+12025550142", keys);

    expect(first.phoneEncryptionIv).not.toBe(second.phoneEncryptionIv);
    expect(first.phoneE164Ciphertext).not.toBe(second.phoneE164Ciphertext);
    expect(first.phoneLookupHash).toBe(second.phoneLookupHash);
  });

  it("rejects invalid numbers and key reuse", () => {
    const keys = createPhoneProtectionKeys(dataKey, lookupKey);

    expect(() => protectPhoneNumber("202-555-0142", keys)).toThrow(/E\.164/);
    expect(() => maskPhoneNumber("+0123")).toThrow(/E\.164/);
    expect(() => createPhoneProtectionKeys(dataKey, dataKey)).toThrow(
      /must be different/,
    );
  });
});
