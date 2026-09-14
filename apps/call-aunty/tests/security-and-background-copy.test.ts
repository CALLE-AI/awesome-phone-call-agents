import { describe, expect, it } from "vitest";
import { getBackgroundTaskCopy, getBackgroundTaskCopySet } from "../lib/background-task-copy";
import { getSecurityCopy, getSecurityStatusSummary } from "../lib/security-copy";

describe("security and background-task localization", () => {
  it("provides complete security settings copy for all supported languages", () => {
    for (const language of ["bn", "en", "hi", "ur", "ta", "te"] as const) {
      const copy = getSecurityCopy(language);
      expect(copy.securitySection.length).toBeGreaterThan(0);
      expect(copy.passcodeFallbackLabel.length).toBeGreaterThan(0);
      expect(copy.backgroundSyncReady.length).toBeGreaterThan(0);
      expect(copy.backgroundSyncUnavailable.length).toBeGreaterThan(0);
    }
  });

  it("uses localized Hindi and Urdu security summaries", () => {
    expect(getSecurityStatusSummary({ passcodeConfigured: true, biometricAvailable: true, locked: false, language: "hi" })).toContain("बायोमेट्रिक");
    expect(getSecurityStatusSummary({ passcodeConfigured: false, biometricAvailable: false, locked: false, language: "ur" })).toContain("پاس کوڈ");
    expect(getSecurityCopy("hi").cooldown(12)).toContain("12");
    expect(getSecurityCopy("ur").cooldown(12)).toContain("۱۲");
    expect(getSecurityCopy("ta").securityTitle).toContain("தனியுரிமை");
    expect(getSecurityCopy("te").securityTitle).toContain("గోప్యతా");
  });

  it("covers every background-task outcome in every supported language", () => {
    const statuses = ["registered", "alreadyRegistered", "completed", "nothingToSync", "offline", "failed", "unavailable"] as const;
    for (const language of ["bn", "en", "hi", "ur", "ta", "te"] as const) {
      const copy = getBackgroundTaskCopySet(language);
      for (const status of statuses) {
        expect(copy[status]).toBe(getBackgroundTaskCopy(language, status));
        expect(copy[status].length).toBeGreaterThan(0);
      }
    }
  });
});
