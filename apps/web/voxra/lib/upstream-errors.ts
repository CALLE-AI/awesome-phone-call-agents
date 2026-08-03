export interface MappedUpstreamError {
  status: number;
  message: string;
}

export function isInvalidTokenUpstreamError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  return raw.includes("CALL-E MCP error 401") || lower.includes("invalid_token");
}

export function mapCalleUpstreamError(err: unknown, fallbackMessage: string): MappedUpstreamError {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (isInvalidTokenUpstreamError(err)) {
    return {
      status: 401,
      message: "CALL-E access token is invalid or expired. Please sign in again to refresh your session.",
    };
  }

  if (raw.includes("CALL-E MCP error 429")) {
    return {
      status: 429,
      message: "CALL-E API rate limit reached. Please retry shortly.",
    };
  }

  if (lower.includes("abort") || lower.includes("timeout")) {
    return {
      status: 504,
      message: "CALL-E request timed out. Please retry.",
    };
  }

  return {
    status: 502,
    message: fallbackMessage,
  };
}
