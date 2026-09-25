import type { CallFailureCode } from "./types";

export class CalleError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(
    message: string,
    opts: { code: string; status?: number; retryable?: boolean; details?: unknown },
  ) {
    super(message);
    this.name = "CalleError";
    this.code = opts.code;
    this.status = opts.status ?? 500;
    this.retryable = opts.retryable ?? false;
    this.details = opts.details;
  }
}

export class CalleTimeoutError extends CalleError {
  constructor() {
    super("CALL-E request timed out", { code: "CALLE_TIMEOUT", status: 504, retryable: true });
  }
}

export class CalleAuthError extends CalleError {
  constructor() {
    super("CALL-E authentication failed", { code: "CALLE_AUTH", status: 502, retryable: false });
  }
}

export class CalleRateLimitError extends CalleError {
  constructor(details?: unknown) {
    super("CALL-E rate limit reached", {
      code: "CALLE_RATE_LIMIT",
      status: 429,
      retryable: true,
      details,
    });
  }
}

export class CalleValidationError extends CalleError {
  constructor(message: string, details?: unknown) {
    super(message, { code: "CALLE_VALIDATION", status: 400, retryable: false, details });
  }
}

export class CalleRemoteError extends CalleError {
  constructor(message: string, status: number, details?: unknown) {
    super(message, { code: "CALLE_REMOTE", status, retryable: status === 408 || status === 429 || status >= 500, details });
  }
}

export class CalleNetworkError extends CalleError {
  constructor(cause?: unknown) {
    super("CALL-E network error", {
      code: "CALLE_NETWORK",
      status: 503,
      retryable: true,
      details: cause,
    });
  }
}

const FAILURE_CODES = new Set<string>([
  "invalid_recipient",
  "unauthorized",
  "missing_consent",
  "unsupported_region",
  "unsupported_language",
  "urgent_state_conflict",
  "calls_disabled",
  "retry_exhausted",
  "duplicate_in_flight",
  "provider_unavailable",
  "timeout",
  "call_failed",
  "no_answer",
  "cancelled",
  "result_invalid",
  "internal_error",
  "insufficient_call_credits",
  "upgrade_required",
  "monthly_call_limit",
]);

/** Map transport / SDK errors onto the workflow failure codes callers already handle. */
export function toCallFailureCode(error: unknown): CallFailureCode {
  if (error instanceof CalleTimeoutError) return "timeout";
  if (error instanceof CalleAuthError) return "provider_unavailable";
  if (error instanceof CalleRateLimitError) return "provider_unavailable";
  if (error instanceof CalleNetworkError) return "provider_unavailable";
  if (error instanceof CalleValidationError) return "result_invalid";
  if (error instanceof CalleRemoteError) {
    return error.retryable ? "provider_unavailable" : "call_failed";
  }
  if (error instanceof CalleError) {
    if (error.code === "CALLE_TIMEOUT") return "timeout";
    if (error.retryable) return "provider_unavailable";
    if (FAILURE_CODES.has(error.code)) {
      return error.code as CallFailureCode;
    }
    return "call_failed";
  }
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code: unknown }).code);
    if (code === "CALLE_TIMEOUT" || code === "timeout") return "timeout";
    if (code === "CALLE_RATE_LIMIT" || code === "CALLE_AUTH" || code === "CALLE_NETWORK") return "provider_unavailable";
    if (FAILURE_CODES.has(code)) return code as CallFailureCode;
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("abort") || message.includes("timeout")) return "timeout";
    if (message.includes("network") || message.includes("fetch") || message.includes("econnrefused")) {
      return "provider_unavailable";
    }
  }
  return "provider_unavailable";
}
