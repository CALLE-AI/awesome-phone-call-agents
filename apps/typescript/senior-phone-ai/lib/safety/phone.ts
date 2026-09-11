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
  const input = nationalNumber.trim();
  if (!/^[+0-9\s().-]+$/.test(input) || (input.includes("+") && !input.startsWith("+"))) {
    throw new Error("enter a phone number without letters or an extension");
  }

  const countryDigits = countryCallingCode.slice(1);
  let digits = input.replace(/[^0-9]/g, "");
  const internationalPrefix = input.startsWith("+")
    ? ""
    : ["0011", "011", "00"].find((prefix) => digits.startsWith(prefix));

  if (input.startsWith("+") || internationalPrefix !== undefined) {
    if (internationalPrefix) digits = digits.slice(internationalPrefix.length);
    if (!digits.startsWith(countryDigits)) {
      throw new Error("phone number country code does not match the selected country");
    }
    digits = digits.slice(countryDigits.length);
  } else if (digits.startsWith(countryDigits) && digits.length >= countryDigits.length + 7) {
    digits = digits.slice(countryDigits.length);
  }
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
