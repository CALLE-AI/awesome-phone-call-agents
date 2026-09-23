import { describe, expect, it } from "vitest";
import { getCooldownProgress, getCooldownSeconds, getPasscodeStrength, isCooldownActive, isValidPasscode, nextFailedAttempt } from "../lib/passcode-utils";

describe("passcode fallback", () => {
  it("accepts only 4 to 6 numeric digits", () => {
    expect(isValidPasscode("1234")).toBe(true);
    expect(isValidPasscode("123456")).toBe(true);
    expect(isValidPasscode("123")).toBe(false);
    expect(isValidPasscode("1234567")).toBe(false);
    expect(isValidPasscode("12a4")).toBe(false);
  });

  it("provides strength guidance and cooldown boundaries", () => {
    expect(getPasscodeStrength("1111")).toContain("predictable");
    expect(getPasscodeStrength("583921")).toContain("Strong");
    const next = nextFailedAttempt(2, 1000);
    expect(next.cooldownUntil).toBe(31_000);
    expect(isCooldownActive(next.cooldownUntil, 30_999)).toBe(true);
    expect(isCooldownActive(next.cooldownUntil, 31_000)).toBe(false);
    expect(getCooldownSeconds(next.cooldownUntil, 1_000)).toBe(30);
    expect(getCooldownSeconds(next.cooldownUntil, 31_000)).toBe(0);
    expect(getCooldownProgress(next.cooldownUntil, 16_000)).toBeCloseTo(0.5);
    expect(getCooldownProgress(next.cooldownUntil, 31_000)).toBe(1);
  });
});
