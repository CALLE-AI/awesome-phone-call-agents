import crypto from "node:crypto";

export class SlidingWindowLimiter {
  private hits: number[] = [];
  constructor(private readonly limit: number, private readonly windowMs: number) {}
  allow(now = Date.now()) {
    while (this.hits.length && this.hits[0]! <= now - this.windowMs) this.hits.shift();
    if (this.hits.length >= this.limit) return false;
    this.hits.push(now);
    return true;
  }
  remaining(now = Date.now()) {
    while (this.hits.length && this.hits[0]! <= now - this.windowMs) this.hits.shift();
    return Math.max(0, this.limit - this.hits.length);
  }
}

export class CircuitBreaker {
  private state: "closed" | "open" | "half_open" = "closed";
  private failures = 0;
  private openedAt = 0;
  constructor(private readonly threshold = 5, private readonly resetMs = 20_000) {}
  canExecute(now = Date.now()) {
    if (this.state === "closed") return true;
    if (this.state === "open" && now - this.openedAt >= this.resetMs) {
      this.state = "half_open";
      return true;
    }
    return this.state === "half_open";
  }
  success() { this.failures = 0; this.state = "closed"; }
  failure(now = Date.now()) {
    this.failures += 1;
    if (this.failures >= this.threshold) { this.state = "open"; this.openedAt = now; }
  }
  snapshot() { return { state: this.state, failures: this.failures, openedAt: this.openedAt || null }; }
}

const PHONE_E164_RE = /\+[1-9](?:[ ().-]*[0-9]){7,14}/g;
const PHONE_LIKE_RE = /[0-9](?:[ ().-]*[0-9]){9,14}/g;
const SECRET_KEY = /token|secret|password|api.?key|authorization|cookie|session/i;
const PHONE_KEY = /phone|phones|recipient|destination|callee|caller|from|to/i;

export function requestId() { return crypto.randomUUID(); }

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return sanitizeText(value);
  const prefix = value.trim().startsWith("+") ? "+" : "";
  return `${prefix}${"•".repeat(Math.max(4, digits.length - 2))}${digits.slice(-2)}`;
}

/** Produces a safe string copy; it never changes the private source value. */
export function sanitizeText(value: string): string {
  let sanitized = value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/Basic\s+[A-Za-z0-9+/=._-]+/gi, "Basic [REDACTED]")
    // Bare 13–19 digit sequences can be payment data, not a phone number. Do not
    // retain even the final digits in logs or public errors.
    .replace(/\b\d{13,19}\b/g, "[REDACTED]");
  sanitized = sanitized.replace(/tel:\+?[0-9().+\-\s]{7,}/gi, (match) => `tel:${maskPhone(match.replace(/^tel:/i, ""))}`);
  sanitized = sanitized.replace(PHONE_E164_RE, (match) => maskPhone(match));
  return sanitized.replace(PHONE_LIKE_RE, (match) => {
    const digits = match.replace(/\D/g, "");
    return digits.length >= 8 && digits.length <= 15 ? maskPhone(match) : match;
  });
}

function redactPhoneContainer(value: unknown, seen: WeakSet<object>): unknown {
  // Structured recipient fields are more sensitive than narrative text. Redact them
  // completely; narrative task/transcript copies still retain a masked safe hint.
  if (typeof value === "string") return "[REDACTED]";
  if (Array.isArray(value)) return value.map((entry) => redactPhoneContainer(entry, seen));
  if (value && typeof value === "object") return redactValue(value, seen);
  return value;
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return sanitizeText(value);
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return { name: value.name, message: sanitizeText(value.message), code: "code" in value ? String((value as Error & { code?: unknown }).code ?? "") : undefined };
  }
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return "[BUFFER_REDACTED]";
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[CIRCULAR_REDACTED]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, seen));

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) output[key] = "[REDACTED]";
    else if (PHONE_KEY.test(key)) output[key] = redactPhoneContainer(nested, seen);
    else output[key] = redactValue(nested, seen);
  }
  return output;
}

/** Creates a recursively sanitized public/log copy without mutating private inputs. */
export function redactObject<T>(value: T): T {
  return redactValue(value, new WeakSet<object>()) as T;
}

export function publicError(error: unknown) {
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown } | null;
  const basis = redactObject(error);
  return {
    code: typeof candidate?.code === "string" ? candidate.code : "UNKNOWN",
    message: typeof candidate?.message === "string" ? sanitizeText(candidate.message) : "Unknown error",
    details: redactObject(candidate?.details),
    requestId: crypto.createHash("sha256").update(JSON.stringify(basis)).digest("hex").slice(0, 16),
  };
}
