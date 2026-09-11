const E164_PATTERN = /^\+[1-9][0-9]{7,14}$/;
const PHONE_LIKE_PATTERN = /[+(]?\d(?:[\d ().-]{6,}\d)/g;

export function isStrictE164(value: string): boolean {
  return E164_PATTERN.test(value);
}

export function assertStrictE164(value: string): string {
  if (!isStrictE164(value)) {
    throw new Error("destination must use strict ASCII E.164 format");
  }
  return value;
}

export function maskPhoneNumber(value: string): string {
  const digits = value.replace(/[^0-9]/g, "");
  return digits.length >= 4 ? `[phone ending ${digits.slice(-4)}]` : "[phone redacted]";
}

export function redactPhoneNumbers(value: string): string {
  return value.replace(PHONE_LIKE_PATTERN, (candidate) => {
    const digitCount = candidate.replace(/[^0-9]/g, "").length;
    return digitCount >= 8 ? maskPhoneNumber(candidate) : candidate;
  });
}
