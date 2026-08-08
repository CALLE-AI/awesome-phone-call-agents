/**
 * Local, offline safety checks for phone numbers and secrets in this app's
 * CLI output — nothing here calls the network.
 */

/** E.164: a leading +, then 7–15 digits, first digit non-zero. */
const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

export function isE164(value: string): boolean {
  return E164_PATTERN.test(value);
}

export function assertE164(value: string, label: string): void {
  if (!isE164(value)) {
    throw new Error(
      `${label} must be an E.164 phone number (e.g. +15555550123), got "${value}". ` +
        "This is checked locally before anything is sent to CALL-E.",
    );
  }
}

/**
 * Masks every E.164-looking substring in a block of text (typically a
 * JSON.stringify'd CALL-E response). The destination number you dialed and
 * any callback number read aloud during the call and captured in the
 * transcript both match this pattern — mask unconditionally rather than only
 * masking known fields, since CALL-E's response shape isn't fully typed and
 * a phone number can show up in fields this app doesn't explicitly model.
 */
export function maskPhoneNumbersInText(text: string): string {
  return text.replace(/\+[1-9]\d{6,14}/g, (match) => {
    const digits = match.slice(1);
    const visibleStart = digits.slice(0, 3);
    const visibleEnd = digits.slice(-2);
    const maskedLength = Math.max(digits.length - visibleStart.length - visibleEnd.length, 3);
    return `+${visibleStart}${"•".repeat(maskedLength)}${visibleEnd}`;
  });
}

/** Placeholder shown in place of a real confirm_token in any printed output. */
export const REDACTED_TOKEN_PLACEHOLDER =
  "[redacted — stored privately, never printed or passed as a CLI argument]";
