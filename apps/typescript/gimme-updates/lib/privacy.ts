/**
 * Masks an E.164 (or E.164-like) phone number for logs and API responses,
 * showing only the last 4 digits. Example: +919876541234 → +91XXXXXX1234.
 *
 * Recipient numbers must never appear in full in logs or in responses
 * returned to the client.
 */
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
