import { describe, expect, it } from "vitest";
import {
  flattenKeys,
  getCanonicalEnglishKeys,
  LOCALE_PACKS,
  resolveTreeValue,
} from "../lib/i18n/catalog";
import { getGlossaryTerm, PROTECTED_GLOSSARY } from "../lib/i18n/glossary";
import { getLanguageDefinition, isCalleSpokenLanguage, listLanguagesForPicker } from "../lib/i18n/language-registry";
import { formatCurrency, formatDate, normalizeDigits } from "../lib/i18n/locale-format";
import { getEffectiveDirection, shouldFlipIcon } from "../lib/i18n/rtl";
import { resetMissingKeyLogForTests, t } from "../lib/i18n/translate";
import { resolveCallLanguage } from "../server/calle/call-language-capability";

describe("V8 i18n foundation", () => {
  it("registers six UI languages with stable codes", () => {
    const rows = listLanguagesForPicker();
    expect(rows.map((r) => r.code).sort()).toEqual(["bn", "en", "hi", "ta", "te", "ur"]);
    expect(getLanguageDefinition("ur").direction).toBe("rtl");
    expect(getLanguageDefinition("bn").calleSpokenCapable).toBe(false);
  });

  it("translates billing keys in Bangla without raw keys", () => {
    resetMissingKeyLogForTests();
    expect(t("billing.title", { language: "bn" })).toContain("প্ল্যান");
    expect(t("billing.demoBuy", { language: "bn" })).toContain("ডেমো");
  });

  it("falls back to English for missing Tamil keys", () => {
    expect(t("billing.title", { language: "ta" })).toContain("Plans");
  });

  it("interpolates placeholders consistently", () => {
    expect(t("billing.restoreCount", { language: "en", values: { count: 2 } })).toContain("2");
  });

  it("validates canonical key parity across locale packs", () => {
    const canonical = getCanonicalEnglishKeys();
    const placeholderRe = /\{(\w+)\}/g;

    for (const [lang, tree] of Object.entries(LOCALE_PACKS)) {
      const keys = flattenKeys(tree);
      const keySet = new Set(keys);
      const missing = canonical.filter((k) => !keySet.has(k));
      expect(missing, `${lang} missing keys`).toEqual([]);

      for (const key of keys) {
        const enVal = resolveTreeValue(LOCALE_PACKS.en, key)!;
        const val = resolveTreeValue(tree, key)!;
        const enPh = [...enVal.matchAll(placeholderRe)].map((m) => m[1]).sort();
        const ph = [...val.matchAll(placeholderRe)].map((m) => m[1]).sort();
        expect(ph, `${lang}:${key}`).toEqual(enPh);
      }
    }
  });

  it("formats locale-aware dates and currency", () => {
    const d = new Date("2026-08-23T12:00:00Z");
    expect(formatDate("bn", d, { month: "long" })).toBeTruthy();
    expect(formatCurrency("en", 10, "USD")).toContain("10");
  });

  it("normalizes localized digits for parsing", () => {
    expect(normalizeDigits("১২৩")).toBe("123");
  });

  it("applies RTL icon flip policy", () => {
    expect(shouldFlipIcon("chevron-back")).toBe(true);
    expect(shouldFlipIcon("phone.fill")).toBe(false);
    expect(getEffectiveDirection("ur")).toBe("rtl");
  });

  it("protects glossary emergency terms", () => {
    expect(getGlossaryTerm("emergency", "bn")).toBe(PROTECTED_GLOSSARY.emergency.bn);
  });
});

describe("CALL-E language capability", () => {
  it("supports English spoken calls", () => {
    const result = resolveCallLanguage({ requested: "en" });
    expect(result.supported).toBe(true);
    expect(result.effective).toBe("en");
  });

  it("does not fabricate Bangla CALL-E support", () => {
    const result = resolveCallLanguage({ requested: "bn", backup: "en" });
    expect(result.supported).toBe(false);
    expect(result.effective).toBe("en");
    expect(result.preservePreference).toBe(true);
    expect(isCalleSpokenLanguage("bn")).toBe(false);
  });

  it("lists honest alternatives", () => {
    const result = resolveCallLanguage({ requested: "hi", backup: "en" });
    expect(result.alternatives).toContain("en");
    expect(result.messageCode).toBe("fallback_applied");
  });
});
