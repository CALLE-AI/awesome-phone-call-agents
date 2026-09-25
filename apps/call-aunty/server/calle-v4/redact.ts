const PATTERNS = [/\b\d{16}\b/g, /\b\d{3}-\d{2}-\d{4}\b/g, /\b\d{6}\b/g];

export function redact(text: string): string {
  let out = text;
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

export function maskPhone(value: string): string {
  if (value.length < 6) return "***";
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}

export function safeMetadata(metadata: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (/token|secret|password|authorization|api[-_]?key/i.test(key)) {
      out[key] = "[REDACTED]";
    } else if (/phone|e164|recipient/i.test(key)) {
      out[key] = maskPhone(value);
    } else {
      out[key] = redact(value);
    }
  }
  return out;
}
