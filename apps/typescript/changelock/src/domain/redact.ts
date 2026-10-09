const E164 = /^\+[1-9]\d{7,14}$/;

const SENSITIVE_PATTERNS: RegExp[] = [
  /\+?\d[\d\s().-]{8,}\d/,
  /\b\d{7,}\b/,
  /\b(account|acct|routing|iban|swift|bic|sort code|card|cvv|otp|one[- ]time (code|passcode)|passcode|password|ssn|social security|tax id|pin)\b[^\n]{0,40}?\b\d{3,}\b/i,
];

export function isE164(value: string): boolean {
  return E164.test(value);
}

export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  if (digits.length < 5) return "+•••";
  return `+${"•".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

export function containsSensitiveData(text: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(text));
}

export function redactSensitiveText(text: string): string {
  return text
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[redacted]")
    .replace(/\b\d{7,}\b/g, "[redacted]");
}
