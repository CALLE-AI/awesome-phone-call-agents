import crypto from "node:crypto";

export class SlidingWindowLimiter {
  private hits: number[] = [];

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

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

  constructor(
    private readonly threshold = 5,
    private readonly resetMs = 20_000,
  ) {}

  canExecute(now = Date.now()) {
    if (this.state === "closed") return true;
    if (this.state === "open" && now - this.openedAt >= this.resetMs) {
      this.state = "half_open";
      return true;
    }
    return this.state === "half_open";
  }

  success() {
    this.failures = 0;
    this.state = "closed";
  }

  failure(now = Date.now()) {
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.state = "open";
      this.openedAt = now;
    }
  }

  snapshot() {
    return { state: this.state, failures: this.failures, openedAt: this.openedAt || null };
  }
}

export function requestId() {
  return crypto.randomUUID();
}

export function sanitizeText(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/\b\d{13,19}\b/g, "[REDACTED]");
}

export function redactObject(value: unknown): unknown {
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) return value.map(redactObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) =>
        /phone|token|secret|password|api.?key/i.test(key)
          ? [key, "[REDACTED]"]
          : [key, redactObject(nested)],
      ),
    );
  }
  return value;
}
