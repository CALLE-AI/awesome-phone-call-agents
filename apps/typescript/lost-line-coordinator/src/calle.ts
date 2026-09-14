import type { CallePort } from "./types.js";

export class CalleConfigError extends Error {}

export const DEFAULT_BASE_URL = "https://api.heycall-e.com";
type FetchLike = (input: Request) => Promise<Response>;

export function assertTrustedBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CalleConfigError("CALLE_BASE_URL is not a URL; CALLE_API_KEY was not sent.");
  }
  if (
    url.protocol !== "https:"
    || url.hostname.toLowerCase() !== "api.heycall-e.com"
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || url.port !== ""
    || !new Set(["", "/"]).has(url.pathname)
  ) {
    throw new CalleConfigError("CALLE_BASE_URL must be exactly https://api.heycall-e.com; CALLE_API_KEY was not sent.");
  }
  return url.toString().replace(/\/$/, "");
}

export async function createSdkPort(options: { apiKey: string; baseUrl?: string; fetch?: FetchLike }): Promise<CallePort> {
  const baseUrl = assertTrustedBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const { CalleClient } = await import("@call-e/calle");
  const client = new CalleClient({ apiKey: options.apiKey, baseUrl, ...(options.fetch ? { fetch: options.fetch } : {}) });
  return {
    create(input, idempotencyKey) {
      return client.calls.create(input, { idempotencyKey });
    },
    waitForResult(callId) {
      return client.calls.waitForResult(callId, { intervalMs: 2_000, timeoutMs: 8 * 60 * 1000 });
    },
  };
}
