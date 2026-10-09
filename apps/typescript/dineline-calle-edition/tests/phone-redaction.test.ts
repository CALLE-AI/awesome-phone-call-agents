import { describe, expect, it } from "vitest";

import { redactPhoneNumbers } from "../src/security/phone-redaction.js";

describe("phone-bearing response redaction", () => {
  it.each([
    "+12025550199",
    "+1 (202) 555-0199",
    "202-555-0199",
    "(202) 555-0199",
    "202.555.0199",
    "+44 20 7946 0958",
  ])("redacts %s", (phone) => {
    expect(redactPhoneNumbers(`Call ${phone} now`)).toBe(
      "Call [phone redacted] now",
    );
  });

  it("does not alter dates, times, IP addresses, or existing masked values", () => {
    const value =
      "2026-09-18 at 19:30 from 127.0.0.1 for +1******0199";

    expect(redactPhoneNumbers(value)).toBe(value);
  });
});
