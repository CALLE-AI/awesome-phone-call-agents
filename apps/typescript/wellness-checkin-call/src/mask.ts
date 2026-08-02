/** Keeps the country code and last two digits, masks the rest. Never log the full number. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.length < 6) return "***";
  const country = digits.slice(0, digits.length > 11 ? 3 : 2);
  const last = digits.slice(-2);
  return `${country}${"*".repeat(digits.length - country.length - 2)}${last}`;
}
