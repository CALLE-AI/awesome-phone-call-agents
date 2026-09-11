/**
 * E.164 phone handling. Numbers are validated strictly and never silently
 * "repaired". Previews, logs, and audit tables must use the masked form.
 */

const E164 = /^\+[1-9]\d{6,14}$/;

export function isValidE164(value: string): boolean {
  return E164.test(value.trim());
}

/**
 * Assert a value is valid E.164, returning the trimmed number. Throws with a
 * clear message rather than guessing or repairing a malformed number.
 */
export function assertE164(value: string, label = "phone"): string {
  const trimmed = value.trim();
  if (!E164.test(trimmed)) {
    throw new Error(
      `Invalid ${label}: ${JSON.stringify(value)} is not E.164 (expected +<countrycode><number>).`,
    );
  }
  return trimmed;
}

/**
 * Mask an E.164 number for previews/logs. Reveals only the leading "+" and the
 * last 4 digits; every other digit becomes "*". Non-E.164 input is fully masked.
 */
export function maskPhone(value: string): string {
  const trimmed = (value ?? "").trim();
  if (!E164.test(trimmed)) return "***";
  const digits = trimmed.slice(1); // drop leading '+'
  const keep = 4;
  const masked = "*".repeat(Math.max(0, digits.length - keep));
  const tail = digits.slice(-keep);
  return `+${masked}${tail}`;
}
