/**
 * CALL-E access, ported behind a small interface so tests can point the real
 * SDK client at a local fake server. The SDK is imported lazily so preview
 * mode and the demo run with nothing installed beyond dev dependencies.
 *
 * The API key goes out on every request, so the base URL is checked before
 * the client is built: it has to be CALL-E itself or loopback (for the fake
 * server). Nothing else gets the credential.
 */
import type { CallSnapshot } from "./types.js";

export interface CreateCallInput {
  task: string;
  phone: string;
  resultSchema: Record<string, unknown>;
  metadata: Record<string, string>;
}

export interface CallePort {
  createCall(input: CreateCallInput, idempotencyKey: string): Promise<CallSnapshot>;
  waitForResult(callId: string, options: { timeoutMs: number; intervalMs: number }): Promise<CallSnapshot>;
}

export class ConfigErrorBaseUrl extends Error {}

export const DEFAULT_BASE_URL = "https://api.heycall-e.com";
const CALLE_HOSTS = ["api.heycall-e.com"];
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1"];

function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

/** Refuses to send the API key anywhere it should not go. */
export function assertTrustedBaseUrl(baseUrl: string): void {
  const advice = "Set CALLE_BASE_URL to https://api.heycall-e.com. Plain http is allowed only on loopback, for the local fake server.";
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ConfigErrorBaseUrl(`CALL-E base URL ${baseUrl} is not a URL, so the API key was not sent. ${advice}`);
  }
  const host = hostOf(url);
  const trusted = new Set([...CALLE_HOSTS, ...LOOPBACK_HOSTS]);
  if (!trusted.has(host)) {
    throw new ConfigErrorBaseUrl(`CALL-E base URL ${baseUrl} is not a host this app trusts. ${advice}`);
  }
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && LOOPBACK_HOSTS.includes(host)) return;
  throw new ConfigErrorBaseUrl(`CALL-E base URL ${baseUrl} does not use https. ${advice}`);
}

export async function createSdkPort(options: { apiKey: string; baseUrl?: string }): Promise<CallePort> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  assertTrustedBaseUrl(baseUrl);
  const { CalleClient } = await import("@call-e/calle");
  const client = new CalleClient({ apiKey: options.apiKey, baseUrl });

  return {
    async createCall(input, idempotencyKey) {
      const call = await client.calls.create(
        {
          task: input.task,
          recipient: { phone: input.phone, locale: "en-US", region: "US" },
          resultSchema: input.resultSchema,
          metadata: input.metadata,
        },
        { idempotencyKey }
      );
      return call as unknown as CallSnapshot;
    },
    async waitForResult(callId, waitOptions) {
      const call = await client.calls.waitForResult(callId, waitOptions);
      return call as unknown as CallSnapshot;
    },
  };
}
