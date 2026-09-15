import { describe, it, expect } from "vitest";
import { maskPhonesInText } from "../src/core/phone";
import { assertApprovedBaseUrl } from "../src/core/livecalle";
import { maskVerifiedOutcome } from "../src/core/mask-output";
import type { VerifiedOutcome } from "../src/core/types";

describe("phone masking in free-text output (review must-fix #3)", () => {
  it("masks E.164 and NANP-formatted numbers", () => {
    expect(maskPhonesInText("call +12025550143 back")).toBe("call +1********43 back");
    const masked = maskPhonesInText("we're at 202-555-0143");
    expect(masked).not.toContain("2025550143");
    expect(masked).not.toContain("555-0143");
  });

  it("leaves times, prices and dates alone", () => {
    const s = "open until 5:00 PM, it's $9.00, on 2026-09-14";
    expect(maskPhonesInText(s)).toBe(s);
  });

  it("masks numbers throughout a verified outcome", () => {
    const o: VerifiedOutcome = {
      overall: "verified",
      callStatus: "completed",
      unreachable: false,
      summary: "reach them at +12025550143",
      fields: [
        {
          key: "callback",
          value: "call +12025550143",
          status: "verified",
          quotes: [{ text: "we're at 202-555-0143", speaker: "user", offsetSeconds: 1 }],
        },
      ],
      transcript: [{ offsetSeconds: 1, speaker: "user", text: "our number is +12025550143" }],
    };
    const m = maskVerifiedOutcome(o);
    expect(m.summary).not.toContain("2025550143");
    expect(m.transcript[0]!.text).not.toContain("2025550143");
    expect(String(m.fields[0]!.value)).not.toContain("2025550143");
    expect(m.fields[0]!.quotes[0]!.text).not.toContain("2025550143");
  });
});

describe("CALLE_BASE_URL allowlist (review must-fix #2)", () => {
  it("accepts approved HTTPS hosts", () => {
    expect(assertApprovedBaseUrl("https://api.heycall-e.com")).toBe("https://api.heycall-e.com");
    expect(assertApprovedBaseUrl("https://test-api.heycall-e.com")).toBe("https://test-api.heycall-e.com");
  });

  it("refuses non-HTTPS, unapproved hosts, and malformed URLs", () => {
    expect(() => assertApprovedBaseUrl("http://api.heycall-e.com")).toThrow(/https/);
    expect(() => assertApprovedBaseUrl("https://evil.example.com")).toThrow(/not an approved/);
    expect(() => assertApprovedBaseUrl("not a url")).toThrow(/valid URL/);
  });
});
