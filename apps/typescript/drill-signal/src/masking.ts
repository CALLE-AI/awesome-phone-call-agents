/**
 * Phone masking and redaction for audit surfaces.
 */

const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

export function isValidE164(phone: string): boolean {
  return E164_PATTERN.test(phone.trim());
}

export function maskPhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.length <= 4) {
    return "****";
  }
  const visible = trimmed.slice(-4);
  const prefix = trimmed.startsWith("+") ? "+" : "";
  const hiddenCount = Math.max(trimmed.length - 4 - (prefix ? 1 : 0), 2);
  return `${prefix}${"*".repeat(hiddenCount)}${visible}`;
}

export function redactPhoneFields(record: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...record };
  for (const key of Object.keys(copy)) {
    if (key.toLowerCase().includes("phone") && typeof copy[key] === "string") {
      copy[key] = maskPhone(copy[key] as string);
    }
  }
  return copy;
}

export function excerptTranscript(turns: { speaker: string; text: string }[], limit = 3): string[] {
  return turns
    .filter((turn) => turn.text.trim().length > 0)
    .slice(0, limit)
    .map((turn) => `${turn.speaker}: ${turn.text.trim().slice(0, 120)}`);
}

export function redactEvidenceLine(line: string): string {
  return line.replace(/\+[1-9]\d{6,14}/g, (match) => maskPhone(match));
}
