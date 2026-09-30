const E164 = /^\+[1-9]\d{6,14}$/;

export function isE164(phone: string): boolean {
  return E164.test(phone);
}

/** Masks a number for logs and screens: +15555550102 -> +155****0102. */
export function maskPhone(phone: string): string {
  if (!isE164(phone)) return "[invalid number]";
  return `${phone.slice(0, 4)}****${phone.slice(-4)}`;
}
