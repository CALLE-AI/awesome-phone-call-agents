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

export function toE164FromNationalNumber(
  countryCallingCode: string,
  nationalNumber: string,
  removeTrunkPrefix = false,
): string {
  if (!/^\+[1-9][0-9]{0,2}$/.test(countryCallingCode)) {
    throw new Error("choose a valid country calling code");
  }
  if (!/^[0-9\s().-]+$/.test(nationalNumber)) {
    throw new Error("enter the local number using digits only");
  }

  let digits = nationalNumber.replace(/[^0-9]/g, "");
  if (removeTrunkPrefix && digits.startsWith("0")) digits = digits.slice(1);
  return assertStrictE164(`${countryCallingCode}${digits}`);
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
