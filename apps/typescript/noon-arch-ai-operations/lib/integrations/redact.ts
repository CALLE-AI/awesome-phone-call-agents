const PHONE_CANDIDATE = /\+\d[\d\s().-]{6,}\d|\b\d[\d\s().-]{6,}\d\b/g;
const PHONE_FIELD = /(?:phone|mobile|telephone|contact[_\s-]?number|رقم\s*الهاتف|جوال)/i;

export function maskPhoneText(value: string): string {
  return value.replace(PHONE_CANDIDATE, (candidate) => {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) return candidate;
    return `[phone ending ${digits.slice(-4)}]`;
  });
}

export function maskPhoneValue(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    if (PHONE_FIELD.test(key) && /\d/.test(value)) {
      const digits = value.replace(/\D/g, "");
      return digits.length >= 4 ? `[phone ending ${digits.slice(-4)}]` : "[phone redacted]";
    }
    return maskPhoneText(value);
  }
  if (typeof value === "number" && PHONE_FIELD.test(key)) return "[phone redacted]";
  if (Array.isArray(value)) return value.map((item) => maskPhoneValue(item, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([field, item]) => [field, maskPhoneValue(item, field)]));
  }
  return value;
}
