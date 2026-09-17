import { describe, expect, it } from "vitest";
import { isE164, maskPhone, regionFromE164, toE164 } from "@/lib/phone";

// All numbers below are fictional (NANP 555-01xx) or zero-filled.

describe("toE164", () => {
  it("normalizes OpenStreetMap-style US numbers", () => {
    expect(toE164("+1-212-555-0142")).toBe("+12125550142");
    expect(toE164("(212) 555-0199")).toBe("+12125550199");
    expect(toE164("1 212 555 0123")).toBe("+12125550123");
  });

  it("applies the area's calling code and drops national trunk prefixes", () => {
    expect(toE164("044 0000 0000", "91")).toBe("+914400000000");
    expect(toE164("tel:+65 6000 0000")).toBe("+6560000000");
  });

  it("takes the first of several numbers and strips extensions", () => {
    expect(toE164("+1 212 555 0142; +1 212 555 0199")).toBe("+12125550142");
    expect(toE164("+1 212 555 0142 ext. 12")).toBe("+12125550142");
  });

  it("returns null instead of guessing", () => {
    expect(toE164("12345")).toBeNull();
    expect(toE164("")).toBeNull();
    expect(toE164(null)).toBeNull();
  });
});

describe("masking and regions", () => {
  it("masks all but the calling code and last two digits", () => {
    const masked = maskPhone("+12125550142");
    expect(masked).toBe("+1 ••• ••• ••42");
    expect(masked).not.toContain("555");
  });

  it("maps calling codes to CALL-E regions", () => {
    expect(regionFromE164("+12125550142")).toBe("US");
    expect(regionFromE164("+914400000000")).toBe("IN");
    expect(regionFromE164("+6560000000")).toBe("SG");
    expect(regionFromE164("+971500000000")).toBe("AE");
  });

  it("validates canonical E.164", () => {
    expect(isE164("+12125550142")).toBe(true);
    expect(isE164("2125550142")).toBe(false);
    expect(isE164("+1 212 555 0142")).toBe(false);
  });
});
