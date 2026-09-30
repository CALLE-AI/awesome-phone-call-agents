// Phone-number safety. The CALL-E merge bar rejects PRs that dial regex-scraped
// text or leak full numbers in logs/errors/transcripts. So: validate strictly,
// and mask everywhere by default.

const E164 = /^\+[1-9]\d{7,14}$/;

export function isValidE164(input: string): boolean {
  return E164.test(input);
}

/** Throws with a MASKED number so a real number never lands in an error string or log. */
export function assertE164(input: string): string {
  if (!isValidE164(input)) {
    throw new InvalidPhoneNumberError(input);
  }
  return input;
}

/**
 * Mask a phone number for display/logs: keep the leading "+" and country digits,
 * reveal only the last two digits. `+12025550123` -> `+1********23`.
 * Opt into full display only with an explicit flag at the UI edge.
 */
export function maskPhone(input: string): string {
  if (!input) return "";
  const plus = input.startsWith("+") ? "+" : "";
  const digits = input.replace(/\D/g, "");
  if (digits.length <= 3) return plus + "*".repeat(digits.length);
  const countryLen = digits.length >= 11 ? 1 : 0; // NANP heuristic; conservative
  const country = digits.slice(0, countryLen);
  const last2 = digits.slice(-2);
  const hiddenCount = digits.length - countryLen - 2;
  return `${plus}${country}${"*".repeat(Math.max(hiddenCount, 0))}${last2}`;
}

/**
 * Mask any phone-shaped substring inside free text (transcript turns, evidence, result
 * values, summaries). Defense in depth: even after verification, a real number spoken on
 * the call must never leave the server in the clear. Matches E.164 (+ and 7-15 digits) and
 * NANP-formatted numbers (XXX-XXX-XXXX with separators); leaves times, prices and dates alone.
 */
const PHONE_IN_TEXT = /\+\d{7,15}|\(?\d{3}\)?[\s.‑-]\d{3}[\s.‑-]\d{4}/g;
export function maskPhonesInText(text: string): string {
  if (!text) return text;
  return text.replace(PHONE_IN_TEXT, (m) => maskPhone(m.replace(/[^\d+]/g, "")));
}

export class InvalidPhoneNumberError extends Error {
  constructor(raw: string) {
    // Never echo the raw invalid value verbatim — mask it.
    super(`invalid E.164 phone number: ${maskPhone(raw)}`);
    this.name = "InvalidPhoneNumberError";
  }
}
