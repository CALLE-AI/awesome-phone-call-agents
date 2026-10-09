import { describe, expect, it } from "vitest";
import {
  maskPhone,
  isE164,
  containsSensitiveData,
  redactSensitiveText,
} from "../../src/domain/redact";

describe("maskPhone", () => {
  it("never emits a full E.164 number", () => {
    const masked = maskPhone("+12025550114");
    expect(masked).not.toContain("2025550114");
    expect(masked).not.toMatch(/\+?\d[\d\s().-]{8,}\d/);
    expect(masked).toContain("0114");
    expect(masked).toMatch(/^\+/);
  });

  it("masks the request-provided number identically", () => {
    expect(maskPhone("+13125550199")).not.toContain("13125550199");
  });
});

describe("isE164", () => {
  it("accepts valid E.164", () => {
    expect(isE164("+12025550114")).toBe(true);
  });
  it("rejects non-E.164", () => {
    expect(isE164("202-555-0114")).toBe(false);
    expect(isE164("+1202555")).toBe(false);
    expect(isE164("+9999999999999999")).toBe(false);
  });
});

describe("containsSensitiveData", () => {
  it("flags long digit runs and financial keywords", () => {
    expect(containsSensitiveData("account 987654321")).toBe(true);
    expect(containsSensitiveData("routing 021000021")).toBe(true);
    expect(containsSensitiveData("my otp is 482916")).toBe(true);
    expect(containsSensitiveData("card number 4111111111111111")).toBe(true);
    expect(containsSensitiveData("call me at +13125550199")).toBe(true);
  });
  it("passes ordinary verification language", () => {
    expect(containsSensitiveData("Yes, our finance team requested the change.")).toBe(false);
    expect(containsSensitiveData("case CL-7F3A9C was initiated by us")).toBe(false);
  });
});

describe("redactSensitiveText", () => {
  it("removes digit runs but keeps meaning", () => {
    const out = redactSensitiveText("send to account 987654321 now");
    expect(out).not.toContain("987654321");
    expect(out).toContain("[redacted]");
  });
});
