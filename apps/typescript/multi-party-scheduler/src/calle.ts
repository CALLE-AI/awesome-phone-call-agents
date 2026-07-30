/**
 * CALL-E access.
 *
 * One small port so the tests can point the real SDK client at a local fake
 * server and so `plan` and `replay` run with nothing installed. The SDK is
 * imported lazily for that reason.
 *
 * `assertTrustedBaseUrl` runs before the client exists, so no request that
 * carries the API key can be built against an untrusted host.
 */

import { ConfigError } from "./config.js";
import type { CallSnapshot, JsonSchema } from "./types.js";

export interface CreateCallInput {
  task: string;
  recipients: { phones: string[]; region?: string; locale?: string }[];
  resultSchema: JsonSchema;
  metadata: Record<string, string | number>;
}

export interface CallePort {
  createCall(input: CreateCallInput, idempotencyKey: string): Promise<CallSnapshot>;
  waitForResult(callId: string, options: { timeoutMs: number; intervalMs: number }): Promise<CallSnapshot>;
  getCall(callId: string): Promise<CallSnapshot>;
}

export class CalleCallError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class CalleWaitTimeout extends Error {}

export const DEFAULT_BASE_URL = "https://api.heycall-e.com";

/** Loopback names the local fake CALL-E can bind to. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Decide whether a base URL may carry the API key, before any request is made.
 *
 * Every request to CALL-E sends `Authorization: Bearer <key>`, so an arbitrary
 * base URL is a way to post the credential somewhere else in plain text. Plain
 * http is allowed only for loopback, which is what the local fake server and the
 * demo use. Anything else is refused rather than warned about: the point is that
 * the key never leaves the process.
 */
export function assertTrustedBaseUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ConfigError(
      `${baseUrl} is not a URL. Set --base-url or CALLE_BASE_URL to an https URL such as ${DEFAULT_BASE_URL}.`,
    );
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  if (url.protocol === "https:" || (url.protocol === "http:" && loopback)) {
    return baseUrl;
  }
  throw new ConfigError(
    `Refusing to send CALLE_API_KEY to ${baseUrl}. --base-url and CALLE_BASE_URL must use https or http only for localhost, 127.0.0.1 or ::1. Nothing was sent.`,
  );
}

export async function createSdkPort(options: {
  apiKey: string;
  baseUrl?: string;
}): Promise<CallePort> {
  const baseUrl = assertTrustedBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const { CalleClient, CalleTimeoutError } = await import("@call-e/calle");
  const client = new CalleClient({
    apiKey: options.apiKey,
    baseUrl,
  });

  const rethrow = (error: unknown): never => {
    if (error instanceof CalleTimeoutError) {
      throw new CalleWaitTimeout(error.message);
    }
    const value = error as { code?: string; message?: string };
    throw new CalleCallError(value?.code ?? "sdk_error", value?.message ?? String(error));
  };

  return {
    async createCall(input, idempotencyKey) {
      try {
        return (await client.calls.create(
          {
            task: input.task,
            recipients: input.recipients,
            resultSchema: input.resultSchema as unknown as Record<string, unknown>,
            metadata: input.metadata,
          },
          { idempotencyKey },
        )) as unknown as CallSnapshot;
      } catch (error) {
        return rethrow(error);
      }
    },
    async waitForResult(callId, waitOptions) {
      try {
        return (await client.calls.waitForResult(callId, waitOptions)) as unknown as CallSnapshot;
      } catch (error) {
        return rethrow(error);
      }
    },
    async getCall(callId) {
      try {
        return (await client.calls.get(callId)) as unknown as CallSnapshot;
      } catch (error) {
        return rethrow(error);
      }
    },
  };
}
