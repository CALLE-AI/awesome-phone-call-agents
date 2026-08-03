import { describe, expect, it } from "vitest";

import {
  assertE164PhoneNumber,
  e164PhoneSchema,
} from "@/domain/phone-number";

describe("E.164 phone numbers", () => {
  it("accepts explicit international numbers and trims surrounding whitespace", () => {
    expect(e164PhoneSchema.parse(" +12025550142 ")).toBe("+12025550142");
    expect(() => assertE164PhoneNumber("+12025550142")).not.toThrow();
  });

  it.each(["123", "+0123456789", "+1202", "+1202555014212345"])(
    "rejects invalid input %s with actionable copy",
    (value) => {
      expect(e164PhoneSchema.safeParse(value).error?.issues[0]).toMatchObject({
        message: "Enter an explicit E.164 number such as +12025550142.",
      });
      expect(() => assertE164PhoneNumber(value)).toThrow(/explicit valid E\.164/);
    },
  );
});
