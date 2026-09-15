/** Masks an E.164 number so only the country code and last two digits remain. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length < 6) return "+***";
  const cc = digits.slice(0, Math.min(3, digits.length - 4));
  return `+${cc}${"*".repeat(digits.length - cc.length - 2)}${digits.slice(-2)}`;
}

/** Replaces any E.164-looking token in free text with its masked form. */
export function maskPhonesInText(text: string): string {
  return text.replace(/\+[1-9]\d{6,14}/g, (m) => maskPhone(m));
}
