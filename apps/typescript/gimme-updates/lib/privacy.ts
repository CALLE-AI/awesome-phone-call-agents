/**
 * Masks an E.164 (or E.164-like) phone number for logs and API responses,
 * showing only the last 4 digits. Example: +919876541234 → +91XXXXXX1234.
 *
 * Recipient numbers must never appear in full in logs or in responses
 * returned to the client.
 */
/** ASCII E.164 only: leading "+", country digit 1-9, then 7-14 more ASCII digits. */
const ASCII_E164 = /^\+[1-9][0-9]{7,14}$/;

const EMBEDDED_E164 = /\+[1-9][0-9]{7,14}/g;
const LONG_DIGIT_RUN = /\b[0-9][0-9\s().-]{8,24}[0-9]\b/g;

const SUBJECT_MAX_LENGTH = 24;

export function isAsciiE164(phoneNumber: string): boolean {
  return ASCII_E164.test(phoneNumber);
}

/**
 * Comma-separated ASCII E.164 numbers from ALLOWED_RECIPIENTS.
 * Entries that are not ASCII E.164 are ignored, so a malformed list
 * cannot accidentally authorize a real call.
 */
export function allowedRecipients(): ReadonlySet<string> {
  const raw = process.env.ALLOWED_RECIPIENTS ?? "";
  const allowed = new Set<string>();
  for (const part of raw.split(",")) {
    const value = part.trim();
    if (isAsciiE164(value)) {
      allowed.add(value);
    }
  }
  return allowed;
}

export function isAllowedRecipient(phoneNumber: string): boolean {
  return isAsciiE164(phoneNumber) && allowedRecipients().has(phoneNumber);
}

function maskDigitRun(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8) {
    return value;
  }
  const withPlus = value.trim().startsWith("+") || digits.length >= 10;
  return maskPhoneNumber(`${withPlus ? "+" : ""}${digits}`);
}

/**
 * Removes phone numbers from free text. Known numbers are replaced even
 * when the provider splits or reformats them; remaining E.164 and long
 * digit runs are masked.
 */
export function redactPhoneNumbers(
  text: string,
  knownPhones: string[] = []
): string {
  let result = text;
  const phones = [...knownPhones].filter((phone) => phone.trim().length > 0);
  phones.sort((a, b) => b.length - a.length);
  for (const phone of phones) {
    const masked = maskPhoneNumber(phone);
    result = result.split(phone).join(masked);
    const digits = phone.replace(/\D/g, "");
    if (digits.length >= 8 && result.includes(digits)) {
      result = result.split(digits).join("X".repeat(digits.length));
    }
  }

  result = result.replace(EMBEDDED_E164, (match) => maskPhoneNumber(match));
  result = result.replace(LONG_DIGIT_RUN, (match) => maskDigitRun(match));
  return result;
}

/** Truncates a subject or decision detail and strips any phone numbers in it. */
export function redactContextText(
  value: string | null | undefined,
  knownPhones: string[] = []
): string | null {
  if (value == null) {
    return null;
  }
  const scrubbed = redactPhoneNumbers(value, knownPhones).replace(/\s+/g, " ").trim();
  if (!scrubbed) {
    return "";
  }
  if (scrubbed.length <= SUBJECT_MAX_LENGTH) {
    return scrubbed;
  }
  return `${scrubbed.slice(0, SUBJECT_MAX_LENGTH)}…`;
}

function replaceKnownPhrases(text: string, phrases: string[]): string {
  let result = text;
  const sorted = [...phrases].filter((phrase) => phrase.trim().length >= 4);
  sorted.sort((a, b) => b.length - a.length);
  for (const phrase of sorted) {
    const replacement = redactContextText(phrase) ?? "[redacted]";
    result = result.split(phrase).join(replacement);
  }
  return result;
}

/**
 * Walks a CALL-E/provider error (message, cause, and nested details) and
 * returns a JSON-safe value with phone numbers and known subject or
 * decision-detail strings removed. Safe to console.error or return.
 */
export function redactProviderError(
  error: unknown,
  options: { phones?: string[]; sensitivePhrases?: string[] } = {},
  depth = 0
): unknown {
  const phones = options.phones ?? [];
  const phrases = options.sensitivePhrases ?? [];
  if (depth > 6) {
    return "[redacted]";
  }
  if (typeof error === "string") {
    return redactPhoneNumbers(replaceKnownPhrases(error, phrases), phones);
  }
  if (typeof error === "number" || typeof error === "boolean" || error == null) {
    return error;
  }
  if (error instanceof Error) {
    const extra =
      "cause" in error ? redactProviderError(error.cause, { phones, sensitivePhrases: phrases }, depth + 1) : undefined;
    const own = { ...error } as Record<string, unknown>;
    const redacted: Record<string, unknown> = {
      name: error.name,
      message: redactPhoneNumbers(replaceKnownPhrases(error.message, phrases), phones),
    };
    if (extra !== undefined) {
      redacted.cause = extra;
    }
    for (const key of Object.keys(own)) {
      if (key === "name" || key === "message" || key === "stack" || key === "cause") {
        continue;
      }
      redacted[key] = redactProviderError(own[key], { phones, sensitivePhrases: phrases }, depth + 1);
    }
    return redacted;
  }
  if (Array.isArray(error)) {
    return error.map((item) =>
      redactProviderError(item, { phones, sensitivePhrases: phrases }, depth + 1)
    );
  }
  if (typeof error === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(error as Record<string, unknown>)) {
      if (key === "stack") {
        continue;
      }
      redacted[key] = redactProviderError(value, { phones, sensitivePhrases: phrases }, depth + 1);
    }
    return redacted;
  }
  return "[redacted]";
}

export function maskPhoneNumber(phoneNumber: string): string {
  const trimmed = phoneNumber.trim();
  if (!trimmed) {
    return trimmed;
  }

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length === 0) {
    return "XXXX";
  }

  if (digits.length <= 4) {
    return `${hasPlus ? "+" : ""}${"X".repeat(digits.length)}`;
  }

  const last4 = digits.slice(-4);
  // Keep a short country-code prefix after '+' so the masked value stays
  // recognizable (matches +91XXXXXX1234). NANP (+1 + 10 digits) keeps 1
  // digit; otherwise keep the first 2.
  const countryCodeLength = hasPlus
    ? digits.startsWith("1") && digits.length === 11
      ? 1
      : Math.min(2, digits.length - 4)
    : 0;
  const countryCode = digits.slice(0, countryCodeLength);
  const maskedCount = digits.length - countryCodeLength - 4;

  return `${hasPlus ? "+" : ""}${countryCode}${"X".repeat(maskedCount)}${last4}`;
}
