import { parsePhoneNumberFromString } from "libphonenumber-js/max";

/** No whitespace, Unicode digits, formatting, extensions, or implicit country codes. */
export function isE164(value: unknown): value is string {
  return typeof value === "string" && /^\+[1-9][0-9]{1,14}(?![\s\S])/.test(value);
}

export function destination(phone: string) {
  if (!isE164(phone)) throw new Error("Enter an exact ASCII E.164 number, including + and country code.");
  const parsed = parsePhoneNumberFromString(phone);
  if (!parsed?.isValid() || !parsed.country || parsed.number !== phone) {
    throw new Error("Enter a valid number with an identifiable destination country.");
  }
  // The task is English; region is determined by the number, never defaulted to US.
  return { phone, region: parsed.country, locale: "en" };
}

export function maskPhone(phone: string): string {
  return `***${phone.slice(-4)}`;
}
