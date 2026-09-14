import { describe, expect, it } from "vitest";
import { assertE164, isValidE164, maskPhone } from "../src/domain/phone.js";

describe("phone", () => {
  it("accepts valid E.164 numbers", () => {
    expect(isValidE164("+15550123456")).toBe(true);
    expect(isValidE164("+919812345678")).toBe(true);
  });

  it("rejects malformed numbers", () => {
    expect(isValidE164("15550123456")).toBe(false);
    expect(isValidE164("+0123")).toBe(false);
    expect(isValidE164("+1 555 012 3456")).toBe(false);
    expect(isValidE164("")).toBe(false);
  });

  it("assertE164 throws rather than repairing", () => {
    expect(() => assertE164("5550123456")).toThrow(/E\.164/);
    expect(assertE164("  +15550123456  ")).toBe("+15550123456");
  });

  it("masks all but the last four digits", () => {
    expect(maskPhone("+15550123456")).toBe("+*******3456");
    expect(maskPhone("+919812345678")).toBe("+********5678");
  });

  it("fully masks non-E.164 input", () => {
    expect(maskPhone("not-a-number")).toBe("***");
    expect(maskPhone("")).toBe("***");
  });
});
