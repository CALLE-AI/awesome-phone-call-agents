import { describe, expect, it } from "vitest";
import { getSecurityStatusSummary, securityCopy } from "../lib/security-copy";

describe("security copy", () => {
  it("returns Bangla cooldown recovery copy", () => {
    expect(securityCopy.cooldown(12)).toContain("১২");
  });

  it("summarizes the strongest available protection", () => {
    expect(getSecurityStatusSummary({ passcodeConfigured: true, biometricAvailable: true, locked: false })).toContain("বায়োমেট্রিক");
    expect(getSecurityStatusSummary({ passcodeConfigured: false, biometricAvailable: false, locked: false })).toContain("পাসকোড");
    expect(getSecurityStatusSummary({ passcodeConfigured: true, biometricAvailable: true, locked: true })).toBe(securityCopy.locked);
  });
});
