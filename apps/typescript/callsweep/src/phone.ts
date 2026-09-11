// Strict E.164: "+" then 7 to 15 digits, first digit 1-9. Nothing else.
export function isE164(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

// Mask a phone number for any user-facing or logged output: keep the leading "+"
// and the last 4 digits, hide the rest. e.g. +14155550100 -> +*******0100
export function maskPhone(phone: string): string {
  if (phone.length <= 5) return "***";
  return "+" + "*".repeat(phone.length - 5) + phone.slice(-4);
}
