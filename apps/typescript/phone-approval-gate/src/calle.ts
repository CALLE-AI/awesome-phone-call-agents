/**
 * CALL-E access.
 *
 * The gate talks to CALL-E through a small port so tests can point it at a
 * local fake server and the live path stays one adapter. The SDK is imported
 * lazily, which keeps `preview` and `verify` runnable with nothing installed.
 */

import { ConfigError } from "./config.js";
import type { CallSnapshot, JsonSchema } from "./types.js";

export interface CallRecipientInput {
  phones: string[];
  region?: string;
  locale?: string;
}

export interface CreateCallInput {
  task: string;
  recipients: CallRecipientInput[];
  resultSchema: JsonSchema;
  metadata: Record<string, string | number>;
}

export interface WaitOptions {
  timeoutMs: number;
  intervalMs: number;
}

export interface CallePort {
  createCall(input: CreateCallInput, idempotencyKey: string): Promise<CallSnapshot>;
  waitForResult(callId: string, options: WaitOptions): Promise<CallSnapshot>;
  getCall(callId: string): Promise<CallSnapshot>;
}

export class GateApiError extends Error {
  readonly code: string;
  readonly status: number | null;
  /**
   * True when the request may already have created a call, so the gate cannot
   * claim nothing happened. A transport failure never reached a reply, a 408 or
   * a 5xx can land after the call was accepted and a 409 on the idempotency key
   * means a call for that key exists. Anything else is a refusal.
   */
  readonly ambiguous: boolean;

  constructor(code: string, message: string, status: number | null = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.ambiguous = status === null || status === 408 || status === 409 || status >= 500;
  }
}

export class GateTimeoutError extends Error {}

export const DEFAULT_BASE_URL = "https://api.heycall-e.com";

/** Hosts that may be reached over plain http, because nothing leaves the box. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Refuse a base URL that the API key must not travel to.
 *
 * The base URL is operator input and the key rides on every request, so the
 * check runs before the client is built rather than after a request has already
 * handed the credential over. Plain http is allowed for loopback only, which is
 * what the local fake CALL-E and the tests use.
 */
export function assertTrustedBaseUrl(baseUrl: string): URL {
  const refuse = (problem: string): never => {
    throw new ConfigError(
      `${problem} Set --base-url or CALLE_BASE_URL to an https URL. Plain http is accepted only for localhost, 127.0.0.1 or ::1. CALLE_API_KEY is not sent anywhere else.`,
    );
  };
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return refuse(`${baseUrl} is not a URL.`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (url.protocol === "https:") {
    return url;
  }
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(host)) {
    return url;
  }
  if (url.protocol !== "http:") {
    return refuse(`${baseUrl} does not use http or https.`);
  }
  return refuse(`${baseUrl} would send CALLE_API_KEY to ${host} unencrypted.`);
}

/**
 * Live adapter over `@call-e/calle`. The SDK is the supported server path for
 * the Developer API, so the gate does not hand-roll HTTP.
 */
export async function createSdkPort(options: {
  apiKey: string;
  baseUrl?: string;
}): Promise<CallePort> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  assertTrustedBaseUrl(baseUrl);
  const { CalleClient, CalleTimeoutError } = await import("@call-e/calle");
  const client = new CalleClient({ apiKey: options.apiKey, baseUrl });

  const rethrow = (error: unknown): never => {
    if (error instanceof CalleTimeoutError) {
      throw new GateTimeoutError(error.message);
    }
    const value = error as { code?: string; message?: string; status?: number };
    throw new GateApiError(
      value?.code ?? "sdk_error",
      value?.message ?? String(error),
      typeof value?.status === "number" ? value.status : null,
    );
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
        return (await client.calls.waitForResult(callId, {
          timeoutMs: waitOptions.timeoutMs,
          intervalMs: waitOptions.intervalMs,
        })) as unknown as CallSnapshot;
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
