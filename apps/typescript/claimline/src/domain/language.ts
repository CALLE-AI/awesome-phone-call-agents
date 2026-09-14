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

/**
 * Common country calling codes → CALL-E region + a sensible locale. CALL-E
 * validates the recipient number against the `region`, so the region MUST match
 * the number's country (a +91 number with region "US" is rejected). We derive it
 * from the phone and express the preferred language for that region when we can.
 */
const PHONE_COUNTRIES: {
  cc: string;
  region: string;
  langs: LanguageCode[];
  default: string;
}[] = [
  { cc: "1", region: "US", langs: ["en", "es"], default: "en-US" },
  { cc: "91", region: "IN", langs: ["en", "hi"], default: "en-IN" },
  { cc: "52", region: "MX", langs: ["es", "en"], default: "es-MX" },
  { cc: "44", region: "GB", langs: ["en"], default: "en-GB" },
  { cc: "61", region: "AU", langs: ["en"], default: "en-AU" },
  { cc: "971", region: "AE", langs: ["en"], default: "en-AE" },
  { cc: "65", region: "SG", langs: ["en"], default: "en-SG" },
  { cc: "49", region: "DE", langs: ["en"], default: "en-DE" },
  { cc: "33", region: "FR", langs: ["en"], default: "en-FR" },
  { cc: "81", region: "JP", langs: ["en"], default: "en-JP" },
];
// Longest calling-code prefix first, so +1 doesn't shadow +91, etc.
PHONE_COUNTRIES.sort((a, b) => b.cc.length - a.cc.length);

/**
 * Derive `{ region, locale }` from an E.164 phone number's country code, keeping
 * the preferred spoken language for that region when supported. Returns null for
 * unknown country codes so callers can fall back to a claim default.
 */
export function regionLocaleForPhone(
  phone: string | null | undefined,
  preferredLocale?: string | null,
): { region: string; locale: string } | null {
  const trimmed = (phone ?? "").trim();
  if (!trimmed.startsWith("+")) return null;
  const body = trimmed.slice(1);
  const match = PHONE_COUNTRIES.find((c) => body.startsWith(c.cc));
  if (!match) return null;
  // With no explicit language preference, use the country's primary locale.
  if (!preferredLocale) return { region: match.region, locale: match.default };
  const lang = languageFromLocale(preferredLocale).code;
  const locale = match.langs.includes(lang) ? `${lang}-${match.region}` : match.default;
  return { region: match.region, locale };
}
