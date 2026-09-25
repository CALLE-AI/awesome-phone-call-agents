const E164 = /^\+[1-9]\d{7,14}$/;

export function normalizePhone(input: string): string {
  const value = input.trim().replace(/[\s().-]/g, "");
  if (!E164.test(value)) {
    throw new Error("Phone must be E.164 formatted");
  }
  return value;
}

export function normalizePhones(values: string[]): string[] {
  return [...new Set(values.map(normalizePhone))];
}

export function isE164(input: string): boolean {
  try {
    normalizePhone(input);
    return true;
  } catch {
    return false;
  }
}
