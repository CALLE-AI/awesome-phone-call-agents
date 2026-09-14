/**
 * Which language Dial should speak on a call.
 *
 * The country is the strongest available signal: ringing a shop in Riyadh and
 * opening in English is a worse first impression than opening in Arabic, and
 * the person who answers may simply not speak English at all.
 *
 * There is deliberately no table of countries to languages here. ICU already
 * ships that data as its "likely subtags" mapping, and it is available through
 * `Intl` with no dependency and no list to maintain -- one that would be wrong
 * the moment a country changed its official language and nobody noticed.
 */

export interface LanguageOption {
  /** BCP-47 code, e.g. 'ar'. What CALL-E is given. */
  code: string;
  /** The language's name in English, e.g. 'Arabic'. */
  englishName: string;
  /** The language's name in itself, e.g. 'العربية'. */
  nativeName: string;
  /** True for the country's own language, which is offered first. */
  recommended: boolean;
}

/** Offered when the country is unknown, and as the universal second choice. */
const FALLBACK_LANGUAGE = 'en';

/**
 * The language most likely spoken in a country, e.g. 'AE' -> 'ar'.
 *
 * Returns null when ICU cannot say. Note this is the *likely* language, not a
 * statement about a country's official languages: Switzerland resolves to
 * German and Canada to English, both of which are defensible first guesses and
 * neither of which is the whole truth. That is exactly why it is offered as a
 * recommendation the user can override rather than applied silently.
 */
export function primaryLanguageForCountry(countryCode: string | null | undefined): string | null {
  const region = (countryCode ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(region)) return null;
  try {
    const language = new Intl.Locale(`und-${region}`).maximize().language;
    // 'und' means ICU had no opinion, which is not an answer.
    return language && language !== 'und' ? language : null;
  } catch {
    return null;
  }
}

/** A language's name in English, falling back to the code itself. */
export function englishNameOf(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** A language's name in that language, falling back to its English name. */
export function nativeNameOf(code: string): string {
  try {
    return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? englishNameOf(code);
  } catch {
    return englishNameOf(code);
  }
}

/**
 * The choices to offer for a call, the country's own language first.
 *
 * Kept short on purpose. This is a question asked while somebody waits for a
 * task to start, not a language picker: the country's language, English, and
 * whatever the user already chose last time covers essentially every real case,
 * and anything else can be typed.
 */
export function languageOptions(
  countryCode: string | null | undefined,
  alsoOffer: Array<string | null | undefined> = [],
): LanguageOption[] {
  const primary = primaryLanguageForCountry(countryCode);
  const ordered: string[] = [];

  const add = (code: string | null | undefined) => {
    const normalized = normalizeLanguageCode(code);
    if (normalized && !ordered.includes(normalized)) ordered.push(normalized);
  };

  add(primary);
  add(FALLBACK_LANGUAGE);
  for (const code of alsoOffer) add(code);

  return ordered.map((code) => ({
    code,
    englishName: englishNameOf(code),
    nativeName: nativeNameOf(code),
    // Only the country's own language earns the label. When ICU has no opinion
    // nothing is recommended, rather than English being dressed up as one.
    recommended: primary !== null && code === primary,
  }));
}

/** The base language of a tag: 'ar-AE' -> 'ar'. Null when it is not a tag. */
export function normalizeLanguageCode(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  try {
    const language = new Intl.Locale(raw).language;
    return language && language !== 'und' ? language : null;
  } catch {
    return null;
  }
}

/**
 * How an option is written when it is shown to the user.
 *
 * The native name is included because it is the one a reader recognises at a
 * glance -- "العربية" is unambiguous to someone who would choose it, in a way
 * that "Arabic" rendered in Latin script is not.
 */
export function describeLanguage(option: LanguageOption): string {
  const both =
    option.nativeName && option.nativeName !== option.englishName
      ? `${option.englishName} — ${option.nativeName}`
      : option.englishName;
  return option.recommended ? `${both} (recommended)` : both;
}

/**
 * Turns whatever the user answered back into a language code.
 *
 * Accepts the label as offered, either name on its own, or a bare code, because
 * the answer is free text: the options are one-tap suggestions, not a closed
 * list, and someone may simply type "french".
 */
export function resolveLanguageAnswer(
  answer: string | null | undefined,
  countryCode: string | null | undefined,
): string | null {
  const raw = (answer ?? '').trim();
  if (!raw) return null;

  // Strip the decoration the option label carries.
  const cleaned = raw
    .replace(/\(recommended\)/i, '')
    .split('—')[0]!
    .trim();
  if (!cleaned) return null;

  /*
   * A code, if that is what was given -- but only if it looks like one.
   * BCP-47 allows a language subtag of two to eight letters, so `Intl.Locale`
   * accepts "arabic" as a perfectly well-formed tag and hands back "arabic" as
   * the language. Real codes are two or three letters; anything longer is a
   * name and belongs in the lookup below.
   */
  if (/^[a-z]{2,3}([-_].*)?$/i.test(cleaned)) {
    const asCode = normalizeLanguageCode(cleaned);
    if (asCode) return asCode;
  }

  // Otherwise match a name, against the offered options first and then against
  // every language ICU knows a name for.
  const needle = cleaned.toLowerCase();
  for (const option of languageOptions(countryCode)) {
    if (option.englishName.toLowerCase() === needle) return option.code;
    if (option.nativeName.toLowerCase() === needle) return option.code;
  }

  for (const code of commonLanguageCodes()) {
    if (englishNameOf(code).toLowerCase() === needle) return code;
    if (nativeNameOf(code).toLowerCase() === needle) return code;
  }
  return null;
}

/**
 * A search space for matching a typed language name.
 *
 * Not a claim about which languages matter -- it is the set ICU can name, kept
 * to two-letter codes so the scan stays cheap. Anything outside it falls back
 * to the saved preference rather than guessing.
 */
function commonLanguageCodes(): string[] {
  const codes: string[] = [];
  for (let a = 97; a <= 122; a += 1) {
    for (let b = 97; b <= 122; b += 1) {
      codes.push(String.fromCharCode(a) + String.fromCharCode(b));
    }
  }
  return codes;
}
