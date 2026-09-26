import type { AppLanguage } from "@/lib/language";
import type { LanguageDefinition, TranslationStatus } from "./types";

const CALLE_SPOKEN = new Set(["en", "en-us", "en-gb", "es", "fr"]);

function def(
  code: AppLanguage,
  displayName: string,
  nativeDisplayName: string,
  locale: string,
  direction: "ltr" | "rtl",
  translationStatus: TranslationStatus,
): LanguageDefinition {
  return {
    code,
    displayName,
    nativeDisplayName,
    locale,
    direction,
    pluralRules: new Intl.PluralRules(locale),
    translationStatus,
    voiceCapable: true,
    calleSpokenCapable: code === "en" || CALLE_SPOKEN.has(code),
    offlinePackAvailable: translationStatus !== "missing",
  };
}

/** Canonical language registry — never use display names as IDs. */
export const LANGUAGE_REGISTRY: Record<AppLanguage, LanguageDefinition> = {
  bn: def("bn", "Bangla", "বাংলা", "bn-BD", "ltr", "complete"),
  en: def("en", "English", "English", "en-US", "ltr", "complete"),
  hi: def("hi", "Hindi", "हिन्दी", "hi-IN", "ltr", "partial"),
  ur: def("ur", "Urdu", "اردو", "ur-PK", "rtl", "partial"),
  ta: def("ta", "Tamil", "தமிழ்", "ta-IN", "ltr", "partial"),
  te: def("te", "Telugu", "తెలుగు", "te-IN", "ltr", "partial"),
};

export const SUPPORTED_UI_LANGUAGES = Object.keys(LANGUAGE_REGISTRY) as AppLanguage[];

export const FALLBACK_LANGUAGE_CHAIN: AppLanguage[] = ["en"];

export function getLanguageDefinition(code: AppLanguage): LanguageDefinition {
  return LANGUAGE_REGISTRY[code] ?? LANGUAGE_REGISTRY.en;
}

export function isCalleSpokenLanguage(code: string): boolean {
  return CALLE_SPOKEN.has(code.toLowerCase());
}

export function listLanguagesForPicker() {
  return SUPPORTED_UI_LANGUAGES.map((code) => {
    const row = LANGUAGE_REGISTRY[code];
    return {
      code,
      nativeDisplayName: row.nativeDisplayName,
      displayName: row.displayName,
      direction: row.direction,
      translationStatus: row.translationStatus,
      offlinePackAvailable: row.offlinePackAvailable,
    };
  });
}
