const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g;
const DISTRESS = /\b(chest pain|can'?t breathe|suicide|self[- ]harm|call 911)\b/gi;

export function minimizeText(text: string): string {
  return text.replace(EMAIL, "[redacted-email]").replace(PHONE, "[redacted-number]").replace(DISTRESS, "[safety-code]");
}

export function containsPii(text: string): boolean {
  EMAIL.lastIndex = 0;
  PHONE.lastIndex = 0;
  return EMAIL.test(text) || PHONE.test(text);
}

export function responseFitsChannel(text: string, channel: "sms" | "call"): string {
  const max = channel === "sms" ? 320 : 800;
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}
