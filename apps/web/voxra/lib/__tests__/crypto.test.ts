import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { decryptString, encryptString } from "../crypto";

const ORIGINAL_KEY = process.env.CALLE_SESSION_ENCRYPTION_KEY;

describe("crypto", () => {
  beforeEach(() => {
    process.env.CALLE_SESSION_ENCRYPTION_KEY = "unit-test-session-encryption-key";
  });

  it("encrypts and decrypts round-trip", () => {
    const cipher = encryptString("hello world");
    const plain = decryptString(cipher);
    expect(plain).toBe("hello world");
  });

  it("returns null for tampered payload", () => {
    const cipher = encryptString("sensitive");
    const parts = cipher.split(".");
    parts[3] = parts[3].slice(0, -1) + (parts[3].endsWith("A") ? "B" : "A");
    const tampered = parts.join(".");
    expect(decryptString(tampered)).toBeNull();
  });

  afterAll(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.CALLE_SESSION_ENCRYPTION_KEY;
    } else {
      process.env.CALLE_SESSION_ENCRYPTION_KEY = ORIGINAL_KEY;
    }
  });
});
