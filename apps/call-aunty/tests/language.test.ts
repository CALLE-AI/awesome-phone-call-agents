import { describe, expect, it } from "vitest";
import { getSecurityCopy, getSecurityStatusSummary } from "../lib/security-copy";
import { getLanguageDirection, getLanguageOption, isAppLanguage, mapDeviceLanguage } from "../lib/language";
import { getAppCopy, getCareCopy, getCarePlanCards, getChwDashboardAccessibilityCopy, getChwDetailCopy, getFollowUpCopy, getSettingsCopy, getSharedCopy, getWomanDashboardAccessibilityCopy } from "../lib/app-copy";

describe("language-driven security copy", () => {
  it("switches cooldown language and numerals", () => {
    expect(getSecurityCopy("en").cooldown(12)).toContain("12 seconds");
    expect(getSecurityCopy("bn").cooldown(12)).toContain("১২");
  });

  it("switches the security summary language", () => {
    expect(getSecurityStatusSummary({ passcodeConfigured: true, biometricAvailable: true, locked: false, language: "en" })).toContain("Biometric");
    expect(getSecurityStatusSummary({ passcodeConfigured: true, biometricAvailable: true, locked: false, language: "bn" })).toContain("বায়োমেট্রিক");
  });

  it("supports Hindi and Urdu registry values with native display names", () => {
    expect(isAppLanguage("hi")).toBe(true);
    expect(isAppLanguage("ur")).toBe(true);
    expect(isAppLanguage("fr")).toBe(false);
    expect(getLanguageOption("hi").nativeName).toContain("हिन्दी");
    expect(getLanguageOption("ur").nativeName).toContain("اردو");
    expect(getLanguageOption("ta").nativeName).toContain("தமிழ்");
    expect(getLanguageOption("te").nativeName).toContain("తెలుగు");
  });

  it("covers translated CHW detail and follow-up route copy", () => {
    expect(getChwDetailCopy("bn").captureTitle).toContain("ফলো-আপ");
    expect(getChwDetailCopy("hi").captureTitle).toContain("फॉलो-अप");
    expect(getChwDetailCopy("ur").summary).toContain("خلاصہ");
    expect(getFollowUpCopy("en").save).toContain("Save");
    expect(getFollowUpCopy("bn").save).toContain("সংরক্ষণ");
    expect(getFollowUpCopy("hi").outcomeOptions.needs_clinician).toContain("चिकित्सक");
    expect(getFollowUpCopy("ur").actionOptions.urgent_review).toContain("فوری");
  });

  it("covers CHW dashboard accessibility summaries in all supported languages", () => {
    expect(getChwDashboardAccessibilityCopy("en").hero).toContain("3 prioritized");
    expect(getChwDashboardAccessibilityCopy("bn").refreshQueue).toContain("রিফ্রেশ");
    expect(getChwDashboardAccessibilityCopy("hi").lockOn).toContain("प्राइवेसी");
    expect(getChwDashboardAccessibilityCopy("ur").syncDiagnostic).toContain("ہم وقت سازی");
    expect(getChwDashboardAccessibilityCopy("ur").openQueueRecord).toContain("فالو اَپ");
  });

  it("covers woman-dashboard accessibility summaries in all supported languages", () => {
    expect(getWomanDashboardAccessibilityCopy("en").startCheckIn).toContain("2 minutes");
    expect(getWomanDashboardAccessibilityCopy("bn").carePlanCard).toContain("কমিউনিটি");
    expect(getWomanDashboardAccessibilityCopy("hi").callAunty).toContain("आंटी");
    expect(getWomanDashboardAccessibilityCopy("ur").callAuntyHint).toContain("محفوظ");
  });

  it("covers localized care-plan stage and accessibility summaries", () => {
    expect(getCareCopy("bn").stageTitle).toContain("২৪");
    expect(getCareCopy("hi").stageMeta).toContain("दूसरी");
    expect(getCareCopy("ur").referralMeta).toContain("کلینک");
    expect(getCarePlanCards("en")[0].accessibilitySummary).toContain("12 days");
    expect(getCarePlanCards("ur")[1].accessibilitySummary).toContain("یاد دہانی");
  });

  it("covers localized care-plan cards and shared clinic contact copy", () => {
    expect(getCarePlanCards("bn")[0].title).toContain("এএনসি");
    expect(getCarePlanCards("hi")[1].state).toContain("नियमित");
    expect(getCarePlanCards("ur")[2].meta).toContain("کلینک");
    expect(getSharedCopy("en").communityClinic).toContain("Community clinic");
    expect(getSharedCopy("bn").communityClinic).toContain("কমিউনিটি");
  });

  it("maps device locales safely and covers shared handoff copy", () => {
    expect(mapDeviceLanguage("bn-BD")).toBe("bn");
    expect(mapDeviceLanguage("hi-IN")).toBe("hi");
    expect(mapDeviceLanguage("ur-PK")).toBe("ur");
    expect(mapDeviceLanguage("ta-IN")).toBe("ta");
    expect(mapDeviceLanguage("te-IN")).toBe("te");
    expect(mapDeviceLanguage("fr-FR")).toBe("en");
    expect(mapDeviceLanguage(undefined)).toBe("en");
    expect(getSharedCopy("bn").callHandoffBody).toContain("কল");
    expect(getSharedCopy("hi").genericErrorTitle).toContain("गलत");
    expect(getSharedCopy("ur").privacyRecoveryBody).toContain("محفوظ");
  });

  it("covers multilingual Settings recovery copy and direction metadata", () => {
    expect(getSettingsCopy("bn").passcodeMismatch).toContain("পাসকোড");
    expect(getSettingsCopy("hi").pickerTitle).toContain("भाषा");
    expect(getSettingsCopy("ur").privacyAlertTitle).toContain("رازداری");
    expect(getLanguageDirection("ur")).toBe("rtl");
    expect(getLanguageDirection("bn")).toBe("ltr");
  });

  it("returns translated core labels and a safe fallback for protected copy", () => {
    expect(getAppCopy("hi").startCheckIn).toContain("चेक-इन");
    expect(getAppCopy("ur").startCheckIn).toContain("چیک اِن");
    expect(getCareCopy("hi").title).toContain("छोटे कदम");
    expect(getCareCopy("ur").title).toContain("چھوٹے قدم");
    expect(getSecurityCopy("hi").lockTitle).toContain("अनलॉक");
    expect(getSecurityCopy("ur").lockTitle).toContain("ان لاک");
  });
});
