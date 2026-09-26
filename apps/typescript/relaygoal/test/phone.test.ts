import { describe, it, expect } from "vitest";
import { isValidE164, assertE164, maskPhone, InvalidPhoneNumberError } from "../src/core/phone";

describe("E.164 validation", () => {
  it("accepts well-formed E.164 numbers", () => {
    expect(isValidE164("+12025550142")).toBe(true);
    expect(isValidE164("+442071838750")).toBe(true);
  });

  it("rejects malformed numbers", () => {
    expect(isValidE164("2025550142")).toBe(false); // no +
    expect(isValidE164("+0abc")).toBe(false);
    expect(isValidE164("+1")).toBe(false); // too short
    expect(isValidE164("")).toBe(false);
  });

  it("assertE164 throws a MASKED error (never echoes the raw number)", () => {
    try {
      assertE164("2025550142");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidPhoneNumberError);
      expect((err as Error).message).not.toContain("2025550142");
    }
  });
});

describe("masking", () => {
  it("reveals only country + last two digits", () => {
    expect(maskPhone("+12025550142")).toBe("+1********42");
  });

  it("never exposes the middle digits", () => {
    const masked = maskPhone("+12025550142");
    expect(masked).not.toContain("202555");
    expect(masked).not.toContain("0142");
  });
});
