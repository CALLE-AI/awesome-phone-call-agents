/**
 * Finding the number to call.
 *
 * The recipient of a phone screen is whoever the application says it is, so the
 * number is read out of the submitted text rather than configured. When the text
 * carries no number there is nobody to call, and both `app/api/call/route.ts`
 * and the questions screen say so rather than falling back to something.
 *
 * This is a parser and not a model call on purpose. A wrong number here dials a
 * stranger, so the rule that picks it should be one you can read and test.
 */

/** CALL-E's recipient format, and the only shape this module ever returns. */
const E164 = /^\+[1-9]\d{7,14}$/;

export function isE164(value: string | undefined | null): value is string {
  return typeof value === "string" && E164.test(value);
}

/**
 * A run of digits and separators that could be a number.
 *
 * Spaces and tabs only — `\s` would let a year at the end of one line join a
 * figure at the start of the next, turning "(2019–2022)\n40+ accounts" into a
 * ten-digit "number". Commas are out for the same reason: `1,250,000` is a
 * count. The lookarounds stop a match from starting or ending mid-figure.
 */
const CANDIDATE = /(?<![\d.,%$])\+?\d[\d ().\t-]{5,20}\d(?![\d%])/g;

/**
 * An explicit label settles it, so these are tried across every field before
 * any bare run is considered anywhere.
 */
const LABELLED = /\b(?:phone|tel|telephone|mobile|cell|direct|contact)\b[^\n\d+]{0,12}(\+?\d[\d ().\t-]{5,20}\d)/gi;

/**
 * The first dialable number in the given texts, in E.164, or null.
 *
 * Fields are searched in the order given, labelled numbers first, so a résumé's
 * contact block wins over a figure that happens to be ten digits long.
 */
export function findPhone(...texts: Array<string | undefined | null>): string | null {
  for (const text of texts) {
    const labelled = firstDialable(text, LABELLED, 1);
    if (labelled) return labelled;
  }
  for (const text of texts) {
    const bare = firstDialable(text, CANDIDATE, 0);
    if (bare) return bare;
  }
  return null;
}

function firstDialable(text: string | undefined | null, pattern: RegExp, group: number): string | null {
  if (!text) return null;
  for (const match of text.matchAll(pattern)) {
    const phone = toE164(match[group]!);
    if (phone) return phone;
  }
  return null;
}

/**
 * Normalizes one matched run, or rejects it.
 *
 * A number with no country code is only dialable if we can supply one, and the
 * only one we can supply without guessing is NANP's +1 — which a ten-digit run,
 * or an eleven-digit run carrying the long-distance 1, identifies. Everything
 * else is declined: a wrong country code is a call to the wrong person.
 */
function toE164(raw: string): string | null {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");

  if (trimmed.startsWith("+")) {
    const candidate = `+${digits}`;
    return E164.test(candidate) ? candidate : null;
  }

  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return null;
}
