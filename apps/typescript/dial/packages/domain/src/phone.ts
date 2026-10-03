import { parsePhoneNumberFromString, findNumbers, type CountryCode } from 'libphonenumber-js';

/**
 * Phone handling. The rule: a number either normalises to valid E.164 or it is
 * null. Dial never guesses, never patches up a partial number, and never hands
 * CALL-E something it has not validated -- a wrong digit dials a stranger.
 */

export interface NormalizedPhone {
  e164: string;
  country: string | null;
  /** Kept for evidence/display; never used for dialling. */
  raw: string;
}

export function normalizePhone(
  raw: string | null | undefined,
  defaultCountry?: string | null,
): NormalizedPhone | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  // Directory data frequently carries several numbers in one field
  // ("+353 1 234 5678; +353 87 999 0000"). Take the first that validates.
  const parts = trimmed.split(/[;,/]| or /i).map((p) => p.trim()).filter(Boolean);

  for (const part of parts) {
    const parsed = parsePhoneNumberFromString(
      part,
      defaultCountry ? (defaultCountry.toUpperCase() as CountryCode) : undefined,
    );
    if (parsed && parsed.isValid()) {
      return { e164: parsed.number, country: parsed.country ?? null, raw: part };
    }
  }
  return null;
}

export function isValidE164(value: string | null | undefined): boolean {
  if (!value) return false;
  if (!/^\+[1-9]\d{6,14}$/.test(value)) return false;
  const parsed = parsePhoneNumberFromString(value);
  return Boolean(parsed?.isValid());
}

export function maskPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = String(value);
  if (s.length <= 4) return '***';
  return `${s.slice(0, 3)}***${s.slice(-2)}`;
}

/**
 * A run of digits long enough to be a phone number, with the punctuation phone
 * numbers are written with. Seven digits is the shortest national number in
 * common use, so prices, times and postcodes are left alone.
 */
const PHONE_LIKE_RUN = /\+?\d[\d\s().\u2013-]{5,}\d/g;

/**
 * Masks every phone number inside free text.
 *
 * Provider responses are written by a language model reading a conversation,
 * so a number can surface anywhere: in a summary ("they asked you to ring
 * 01 555 0132"), inside a structured result, or in an error. The raw number
 * already lives on the call row server-side, and none of those surfaces need
 * it, so it is masked on the way in rather than at each render site -- one
 * boundary that cannot be forgotten is worth more than a rule everyone has to
 * remember.
 */
export function maskPhonesInText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value);
  if (!s) return s;
  return s.replace(PHONE_LIKE_RUN, (match) => {
    if (match.replace(/\D/g, '').length < 7) return match;
    const trimmed = match.trim();
    return trimmed.length <= 4 ? '***' : `${trimmed.slice(0, 3)}***${trimmed.slice(-2)}`;
  });
}

/**
 * Recursively masks phone numbers in a parsed provider payload.
 *
 * Structured results are arbitrary JSON: the number can be a top-level string,
 * a value inside a nested object, or an item in an array. Walking the value is
 * the only way to cover a schema Dial did not author.
 */
export function maskPhonesInValue(value: unknown): unknown {
  if (typeof value === 'string') return maskPhonesInText(value);
  if (Array.isArray(value)) return value.map(maskPhonesInValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = maskPhonesInValue(item);
    }
    return out;
  }
  return value;
}

/**
 * Premium-rate, and non-routable test ranges. Dial refuses to dial these: the
 * first bills the user by the minute, the second is reserved for fiction.
 */
const BLOCKED_PATTERNS: RegExp[] = [
  /^\+1900\d+$/, // US premium
  /^\+1976\d+$/,
  /^\+44(9|87)\d+$/, // UK premium / revenue share
  /^\+1\d{3}555(01\d{2})$/, // NANP fictional range, 555-0100..555-0199
  /^\+442079460\d{3}$/, // UK Ofcom drama range, 020 7946 0xxx
  /^\+447700900\d{3}$/, // UK Ofcom drama range, 07700 900xxx
];

export function isBlockedNumber(e164: string): boolean {
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(e164));
}

/**
 * Two directory entries for the same shop are common (one from the map, one
 * from a listing). Same E.164 means same business for calling purposes.
 */
export function dedupeByPhone<T extends { phoneE164: string | null }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (!item.phoneE164) continue;
    if (seen.has(item.phoneE164)) continue;
    seen.add(item.phoneE164);
    out.push(item);
  }
  return out;
}

/** Normalises a business name for duplicate detection across sources. */
export function businessNameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(ltd|limited|inc|llc|plc|gmbh|co|company|the)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * A phone number the user typed into their own request.
 *
 * When somebody says "call +971 55 550 1234 and ask about my order" they have
 * already answered the question the whole search stage exists to answer. Asking
 * them where to look would be absurd -- there is nothing to look for.
 *
 * Found in code rather than asked of the model. A phone number is a precisely
 * specified pattern with a library that validates it, so extraction is exact
 * and testable, where a model would occasionally return a price or an order
 * number and Dial would ring it.
 */
export interface DialTarget {
  e164: string;
  /** Exactly as the user wrote it, for showing back to them. */
  raw: string;
  /** ISO 3166-1 alpha-2 the number belongs to, when it can be determined. */
  country: string | null;
}

export function extractDialTargets(
  text: string | null | undefined,
  defaultCountry?: string | null,
): DialTarget[] {
  const source = (text ?? '').trim();
  if (!source) return [];

  const region = defaultCountry?.toUpperCase();
  const found = [
    // International form needs no hint and is unambiguous, so it goes first.
    ...safeFind(source, undefined),
    // A national form only resolves with a country to read it against.
    ...(region ? safeFind(source, region as CountryCode) : []),
  ];

  const seen = new Set<string>();
  const targets: DialTarget[] = [];
  for (const match of found) {
    const e164 = match.number.number;
    if (seen.has(e164) || isBlockedNumber(e164)) continue;
    seen.add(e164);
    targets.push({
      e164,
      raw: source.slice(match.startsAt, match.endsAt),
      country: match.number.country ?? null,
    });
  }
  return targets;
}

function safeFind(text: string, region: CountryCode | undefined) {
  try {
    return findNumbers(text, region ? { defaultCountry: region, v2: true } : { v2: true });
  } catch {
    // A malformed hint must not stop the rest of the request being read.
    return [];
  }
}
