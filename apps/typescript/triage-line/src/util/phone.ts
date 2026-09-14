/**
 * Phone number utilities: E.164 validation and masking.
 *
 * Safety rationale:
 *   - Every real (live) dial leg must be a valid, explicitly authorized E.164
 *     number. We never dial free-form or provider-discovered strings without
 *     validating them first (see isValidE164 / assertValidE164).
 *   - Phone numbers are personal data. They are masked before appearing in any
 *     snapshot, event, transcript, or debug output (see maskPhone).
 */

/**
 * Strict-ish E.164: a leading "+", a nonzero leading country-code digit, then
 * up to 14 more digits (E.164 max is 15 digits total). No spaces or separators.
 */
const E164 = /^\+[1-9]\d{6,14}$/;

export function isValidE164(phone: string | undefined | null): boolean {
  return typeof phone === "string" && E164.test(phone.trim());
}

/**
 * Throw if a number is not a valid E.164. `context` is included in the error so
 * a failed live leg is easy to trace (e.g. which node / discovered field).
 */
export function assertValidE164(
  phone: string | undefined | null,
  context: string
): string {
  const p = (phone ?? "").trim();
  if (!isValidE164(p)) {
    throw new Error(
      `Refusing to dial: "${maskPhone(p) || "(empty)"}" is not a valid ` +
        `authorized E.164 number (${context}).`
    );
  }
  return p;
}

/**
 * Mask a phone number for display/logging: keep the country-code "+" prefix and
 * the last 2 digits, replace the middle with bullets.
 *   +14155550188 -> +1•••••••88
 * Non-E.164 or short values are fully masked.
 */
export function maskPhone(phone: string | undefined | null): string {
  const p = (phone ?? "").trim();
  if (!p) return "";
  if (!/^\+?\d+$/.test(p) || p.replace(/\D/g, "").length < 4) {
    return "•••";
  }
  const plus = p.startsWith("+") ? "+" : "";
  const digits = p.replace(/\D/g, "");
  const cc = digits.slice(0, 1);
  const last2 = digits.slice(-2);
  const hidden = "•".repeat(Math.max(3, digits.length - 3));
  return `${plus}${cc}${hidden}${last2}`;
}

/**
 * Redact any E.164-looking substrings inside an arbitrary string (transcripts,
 * debug blobs, free text) by masking them in place.
 */
export function redactPhones(text: string): string {
  return text.replace(/\+[1-9]\d{6,14}/g, (m) => maskPhone(m));
}
