/**
 * Call language support. CALL-E speaks the recipient's locale; we also inject an
 * explicit "conduct the call in <language>" instruction into the task so the
 * spoken language is unambiguous. Each option maps to a supported CALL-E region
 * + locale (see the CALL-E supported regions and languages table).
 */
export type LanguageCode = "en" | "hi" | "es";

export interface LanguageOption {
  code: LanguageCode;
  name: string; // English name of the language, used in the spoken instruction
  region: string; // CALL-E country code
  locale: string; // CALL-E locale
  label: string; // UI label
}

export const LANGUAGES: Record<LanguageCode, LanguageOption> = {
  en: { code: "en", name: "English", region: "US", locale: "en-US", label: "English" },
  hi: { code: "hi", name: "Hindi", region: "IN", locale: "hi-IN", label: "Hindi (हिन्दी)" },
  es: { code: "es", name: "Spanish", region: "MX", locale: "es-MX", label: "Spanish (Español)" },
};

export const LANGUAGE_CODES: LanguageCode[] = ["en", "hi", "es"];

export function isLanguageCode(value: unknown): value is LanguageCode {
  return value === "en" || value === "hi" || value === "es";
}

export function languageFor(code: string | null | undefined): LanguageOption {
  return isLanguageCode(code) ? LANGUAGES[code] : LANGUAGES.en;
}

/** Best-effort reverse lookup: derive the language option from a locale string. */
export function languageFromLocale(locale: string | null | undefined): LanguageOption {
  const l = (locale ?? "").toLowerCase();
  if (l.startsWith("hi")) return LANGUAGES.hi;
  if (l.startsWith("es")) return LANGUAGES.es;
  return LANGUAGES.en;
}
