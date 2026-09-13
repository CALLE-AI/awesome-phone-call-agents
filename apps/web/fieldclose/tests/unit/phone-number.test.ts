import { describe, expect, it } from "vitest";

import {
  assertE164PhoneNumber,
  e164PhoneSchema,
  usE164PhoneSchema,
} from "@/domain/phone-number";

describe("E.164 phone numbers", () => {
  it("accepts explicit international numbers and trims surrounding whitespace", () => {
    expect(e164PhoneSchema.parse(" +12025550142 ")).toBe("+12025550142");
    expect(() => assertE164PhoneNumber("+12025550142")).not.toThrow();
  });

  it.each(["123", "+0123456789", "+1202", "+1-202-555-0142"])(
    "rejects invalid input %s with actionable copy",
    (value) => {
      expect(e164PhoneSchema.safeParse(value).error?.issues[0]).toMatchObject({
        message: "Enter an explicit E.164 number such as +12025550142.",
      });
      expect(() => assertE164PhoneNumber(value)).toThrow(/explicit valid E\.164/);
    },
  );
});

describe("US E.164 phone numbers", () => {
  it("accepts an explicit US +1 number", () => {
    expect(usE164PhoneSchema.parse(" +12025550142 ")).toBe("+12025550142");
  });

  it("rejects a non-US E.164 number instead of pairing it with the US provider region", () => {
    expect(usE164PhoneSchema.safeParse("+442079460000").error?.issues[0]).toMatchObject({
      message: "Enter an explicit US E.164 number beginning with +1.",
    });
  });
});
