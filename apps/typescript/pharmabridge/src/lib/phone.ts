// E.164 helpers. CALL-E requires canonical E.164 (`^\+[1-9]\d{7,14}$`) for every recipient.

const E164 = /^\+[1-9]\d{7,14}$/;

// Calling codes for the regions CALL-E documents, longest prefixes first when matching.
const REGION_BY_CODE: Record<string, string> = {
  "1": "US",
  "7": "KZ",
  "27": "ZA",
  "31": "NL",
  "44": "GB",
  "52": "MX",
  "55": "BR",
  "60": "MY",
  "61": "AU",
  "62": "ID",
  "63": "PH",
  "65": "SG",
  "81": "JP",
  "91": "IN",
  "234": "NG",
  "254": "KE",
  "353": "IE",
  "971": "AE",
};

const CODE_BY_COUNTRY: Record<string, string> = Object.fromEntries(
  Object.entries(REGION_BY_CODE).map(([code, region]) => [region, code]),
);
CODE_BY_COUNTRY.CA = "1";

export function isE164(value: string | null | undefined): value is string {
  return typeof value === "string" && E164.test(value);
}

export function callingCodeForCountry(countryCode: string | null | undefined): string | null {
  if (!countryCode) return null;
  return CODE_BY_COUNTRY[countryCode.toUpperCase()] ?? null;
}

export function callingCode(e164: string): string | null {
  const digits = e164.replace(/^\+/, "");
  for (const len of [3, 2, 1]) {
    const prefix = digits.slice(0, len);
    if (REGION_BY_CODE[prefix]) return prefix;
  }
  return null;
}

export function regionFromE164(e164: string): string | null {
  const code = callingCode(e164);
  return code ? REGION_BY_CODE[code] : null;
}

/**
 * Normalizes a raw phone string (an OpenStreetMap tag or user input) to E.164.
 * Returns null instead of guessing when the result would not be valid.
 */
export function toE164(raw: string | null | undefined, defaultCallingCode = "1"): string | null {
  if (!raw) return null;
  const first = raw.split(/[;,]/)[0].replace(/^tel:/i, "").trim();
  const withoutExtension = first.replace(/\s*(?:ext\.?|x|#)\s*\d+\s*$/i, "");
  const hasPlus = withoutExtension.startsWith("+");
  let digits = withoutExtension.replace(/\D/g, "");
  if (!digits) return null;

  if (hasPlus) {
    // already international
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (defaultCallingCode === "1" && digits.length === 11 && digits.startsWith("1")) {
    // NANP number that already carries its country code
  } else if (digits.startsWith("0")) {
    digits = defaultCallingCode + digits.slice(1); // drop the national trunk prefix
  } else {
    digits = defaultCallingCode + digits;
  }

  const e164 = `+${digits}`;
  return E164.test(e164) ? e164 : null;
}

/** Masks all but the calling code and last two digits, per the showcase repo's safety rules. */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return "not listed";
  const code = callingCode(e164) ?? e164.slice(1, 3);
  return `+${code} ••• ••• ••${e164.slice(-2)}`;
}

// Phone-like text: +digits with separators, (NNN) NNN-NNNN style, or a bare run of nine or more digits.
const PHONE_LIKE = /\+\s?\d[\d\s().-]{6,}\d|\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|(?<![\w/:.-])\d{9,}(?!\w)/g;

/** Masks phone numbers inside free text (transcripts, summaries, errors), keeping the last two digits. */
export function redactPhones(text: string): string {
  return text.replace(PHONE_LIKE, (match) => {
    const digits = match.replace(/\D/g, "");
    return digits.length >= 7 ? `••• ••• ••${digits.slice(-2)}` : match;
  });
}

/** Applies redactPhones to every string inside a JSON-like value. */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redactPhones(value) as T;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactDeep(item)])) as T;
  }
  return value;
}
