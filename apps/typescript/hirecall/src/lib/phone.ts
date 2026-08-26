const E164_IN_TEXT = /\+[1-9]\d{7,14}/g;

export function looksMasked(phone: string): boolean {
  return phone.includes("*");
}

export function maskPhone(phone: string): string {
  const value = phone.trim();
  if (!value) return "";
  if (looksMasked(value)) return value;
  const digits = value.startsWith("+") ? value.slice(1).replace(/\D/g, "") : value.replace(/\D/g, "");
  if (digits.length < 5) return "+****";
  return `+${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

export function maskE164InText(value: string): string {
  return value.replace(E164_IN_TEXT, (match) => maskPhone(match));
}
