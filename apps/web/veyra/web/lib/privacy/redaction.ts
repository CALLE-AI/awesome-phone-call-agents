const REDACTED = "[REDACTED]";
const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 100;
const MAX_OBJECT_KEYS = 100;

const SECRET_KEY = /(authorization|api[_-]?key|token|secret|password|credential|cookie)/i;
const PHONE_KEY = /(phone|mobile|telephone|destination)/i;
const EMAIL_KEY = /e-?mail/i;

export function maskPhoneForDisplay(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? `[PHONE ••••${digits.slice(-4)}]` : "[PHONE REDACTED]";
}

/** Removes credentials and direct contact details from arbitrary provider/user text. */
export function redactSensitiveText(value: string, maxLength = 20_000): string {
  return value
    .replace(
      /\b(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*["']?[^\s,"']+/gi,
      "$1=[REDACTED]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|rk|pk)[_-][A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^@\s/]+)@/gi, "$1[REDACTED]@")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL REDACTED]")
    .replace(/(?<![A-Za-z0-9])(?:\+?\d[\d\s().-]{6,}\d)(?![A-Za-z0-9])/g, (candidate) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(candidate.trim())) return candidate;
      const digits = candidate.replace(/\D/g, "");
      return digits.length >= 8 && digits.length <= 15 ? maskPhoneForDisplay(candidate) : candidate;
    })
    .slice(0, Math.max(0, maxLength));
}

function sanitize(value: unknown, key: string, depth: number, seen: WeakSet<object>): unknown {
  if (SECRET_KEY.test(key)) return REDACTED;
  if (PHONE_KEY.test(key)) {
    return value === null || value === undefined ? value : maskPhoneForDisplay(value);
  }
  if (EMAIL_KEY.test(key)) return value === null || value === undefined ? value : "[EMAIL REDACTED]";
  if (typeof value === "string") return redactSensitiveText(value);
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value !== "object") return String(value);
  if (depth >= MAX_DEPTH || seen.has(value)) return "[TRUNCATED]";

  seen.add(value);
  if (Array.isArray(value)) {
    const result = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitize(item, key, depth + 1, seen));
    if (value.length > MAX_ARRAY_ITEMS) result.push("[TRUNCATED]");
    return result;
  }

  const result: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
    if (["__proto__", "prototype", "constructor"].includes(childKey)) continue;
    const safeKey = redactSensitiveText(childKey, 120);
    result[safeKey] = sanitize(childValue, childKey, depth + 1, seen);
  }
  if (Object.keys(value).length > MAX_OBJECT_KEYS) result._truncated = true;
  return result;
}

/** Deeply sanitizes structured CALL-E output, including nested arrays and transcript turns. */
export function sanitizeResultData(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return sanitize(value, "", 0, new WeakSet()) as Record<string, unknown>;
}

export function sanitizeSummary(value: string | null | undefined): string | null {
  return value ? redactSensitiveText(value, 20_000) : null;
}

export function sanitizeTranscript(value: string | null | undefined): string | null {
  return value ? redactSensitiveText(value, 200_000) : null;
}

/** Provider failures are deliberately not echoed: they can contain request bodies or PII. */
export function publicProviderFailureMessage(): string {
  return "CALL-E did not confirm the call outcome. Review the provider dashboard before retrying.";
}

export function sanitizeDisplayError(value: string | null | undefined): string | null {
  return value ? redactSensitiveText(value, 500) : null;
}

export function sanitizeFailureCode(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : "provider_failure";
}
