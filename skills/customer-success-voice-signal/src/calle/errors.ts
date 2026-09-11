export type CalleFailureCategory =
  | "authentication"
  | "network"
  | "timeout"
  | "provider_error";

const SECRETISH =
  /(api[_-]?key|bearer|password|token|authorization)\s*[:=]\s*\S+/gi;
const BEARER = /\bbearer\s+[a-z0-9._\-]+/gi;
const SK_KEYS = /\bsk-[a-z0-9]+\b/gi;

/** Redact obvious secrets from error text before writeback. */
export function scrubErrorText(raw: string, maxLen = 280): string {
  return raw
    .replace(SECRETISH, "$1=[redacted]")
    .replace(BEARER, "Bearer [redacted]")
    .replace(SK_KEYS, "[redacted]")
    .replace(/\+\d{8,15}/g, "[phone]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

export function categorizeCalleError(err: unknown): {
  category: CalleFailureCategory;
  summary: string;
} {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  let category: CalleFailureCategory = "provider_error";
  if (
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("unauthorized") ||
    lower.includes("authentication") ||
    lower.includes("api_key") ||
    lower.includes("calle_api_key")
  ) {
    category = "authentication";
  } else if (
    lower.includes("timeout") ||
    lower.includes("etimedout") ||
    lower.includes("deadline")
  ) {
    category = "timeout";
  } else if (
    lower.includes("network") ||
    lower.includes("econn") ||
    lower.includes("enotfound") ||
    lower.includes("fetch failed") ||
    lower.includes("socket")
  ) {
    category = "network";
  }
  return { category, summary: scrubErrorText(msg) };
}
