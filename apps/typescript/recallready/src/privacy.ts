import { createHash } from "node:crypto";

const E164 = /^\+[1-9]\d{7,14}$/;

export function normalizeUsPhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (value.startsWith("+") && E164.test(`+${digits}`)) return `+${digits}`;
  return null;
}

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? `••• ••• ${digits.slice(-4)}` : "••• ••• ••••";
}

export function extractPublishedUsPhone(contact: string): string | null {
  const match = contact.match(/(?:\+?1[\s.-]*)?\(?([2-9]\d{2})\)?[\s.-]*(\d{3})[\s.-]*(\d{4})/);
  if (!match) return null;
  return normalizeUsPhone(`${match[1]}${match[2]}${match[3]}`);
}

export function stableFingerprint(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 16);
}

export function cleanShortText(value: unknown, maxLength = 120): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}
