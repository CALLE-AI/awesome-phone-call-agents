import { CalleAuthError, CalleError, CalleNetworkError, CalleRateLimitError, CalleRemoteError, CalleTimeoutError, CalleValidationError } from "./errors";

const FALLBACK_REASON = {
  missing_key: "missing_api_key",
  timeout: "timeout",
  auth: "unauthorized",
  rate_limit: "rate_limit",
  remote: "provider_unavailable",
  network: "network_error",
} as const;

export type MockFallbackReason = (typeof FALLBACK_REASON)[keyof typeof FALLBACK_REASON];

export function isMockCallId(id: string): boolean {
  return /^(call_mock_|demo_)/.test(id);
}

export function fallbackReasonFromError(error: unknown): MockFallbackReason {
  if (error instanceof CalleTimeoutError) return FALLBACK_REASON.timeout;
  if (error instanceof CalleAuthError) return FALLBACK_REASON.auth;
  if (error instanceof CalleRateLimitError) return FALLBACK_REASON.rate_limit;
  if (error instanceof CalleNetworkError) return FALLBACK_REASON.network;
  if (error instanceof CalleRemoteError) return FALLBACK_REASON.remote;
  if (error instanceof Error && /CALLE_API_KEY is not configured/.test(error.message)) {
    return FALLBACK_REASON.missing_key;
  }
  return FALLBACK_REASON.network;
}

/** Transport / provider outages may use mock fixtures. Policy/validation errors must not. */
export function isMockFallbackEligible(error: unknown, enabled = true): boolean {
  if (!enabled) return false;
  if (error instanceof CalleValidationError) return false;
  if (error instanceof CalleAuthError) return true;
  if (error instanceof CalleTimeoutError || error instanceof CalleRateLimitError || error instanceof CalleNetworkError) return true;
  if (error instanceof CalleRemoteError) {
    return error.status === 404 || error.status === 408 || error.status === 429 || error.status >= 500;
  }
  if (error instanceof CalleError) return error.retryable;
  if (error && typeof error === "object" && "status" in error) {
    const status = Number((error as { status: number }).status);
    if (Number.isFinite(status)) {
      return status === 401 || status === 403 || status === 404 || status === 408 || status === 429 || status >= 500;
    }
  }
  if (error instanceof Error && /CALLE_API_KEY is not configured/.test(error.message)) {
    return true;
  }
  return true;
}

export function tagFallbackMetadata(
  metadata: Record<string, string> | undefined,
  reason: MockFallbackReason,
): Record<string, string> {
  return {
    ...(metadata ?? {}),
    calle_source: "mock_fallback",
    calle_fallback_reason: reason,
  };
}

export async function withMockFallback<T>(
  live: () => Promise<T>,
  fallback: () => T | Promise<T>,
  enabled = true,
): Promise<T> {
  try {
    return await live();
  } catch (error) {
    if (!isMockFallbackEligible(error, enabled)) throw error;
    return fallback();
  }
}
