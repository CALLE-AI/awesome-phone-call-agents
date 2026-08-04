/** Mask an E.164 number for display: keep "+", the first two digits, and the last three. */
export function maskE164(phone: string): string {
  if (!phone.startsWith("+") || phone.length < 8) return "•••";
  const prefix = phone.slice(0, 3);
  const suffix = phone.slice(-3);
  return `${prefix}${"•".repeat(phone.length - 6)}${suffix}`;
}
