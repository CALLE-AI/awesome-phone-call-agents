export const E164_PHONE = /^\+[1-9]\d{7,14}$/;

export function isE164Phone(value: string): boolean {
  return E164_PHONE.test(value.trim());
}

export function describeNetworkError(error: unknown, fallback: string): string {
  if (error instanceof TypeError) {
    return "Network error. Check your connection and try again.";
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      error.name === "AbortError" ||
      message.includes("abort") ||
      message.includes("network") ||
      message.includes("failed to fetch") ||
      message.includes("timeout") ||
      message.includes("econnrefused") ||
      message.includes("enotfound")
    ) {
      return "Network error. Check your connection and try again.";
    }
    return error.message;
  }
  return fallback;
}

export function parseJsonText<T>(text: string, fallback: string): T {
  if (!text.trim()) {
    throw new Error(`${fallback}: empty response`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${fallback}: invalid JSON`);
  }
}

export function errorMessageFromBody(text: string, status: number, fallback: string): string {
  if (!text.trim()) return `${fallback} (${status})`;
  try {
    const payload = JSON.parse(text) as { error?: string; message?: string };
    return payload.error ?? payload.message ?? `${fallback} (${status})`;
  } catch {
    return text.length > 180 ? `${fallback} (${status})` : text;
  }
}

export const MAX_TRANSIENT_POLL_FAILURES = 3;

export function isTransientPollFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    error.name === "AbortError" ||
    message.includes("network") ||
    message.includes("failed to fetch") ||
    message.includes("timeout") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504") ||
    message.includes("invalid json") ||
    message.includes("empty response")
  );
}

export function nextPollFailureState(
  consecutiveFailures: number,
  error: unknown,
  max = MAX_TRANSIENT_POLL_FAILURES,
): { consecutiveFailures: number; fatal: boolean } {
  if (!isTransientPollFailure(error)) {
    return { consecutiveFailures: consecutiveFailures + 1, fatal: true };
  }
  const next = consecutiveFailures + 1;
  return { consecutiveFailures: next, fatal: next >= max };
}
