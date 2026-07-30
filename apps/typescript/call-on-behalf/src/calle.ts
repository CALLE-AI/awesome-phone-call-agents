/**
 * CALL-E access.
 *
 * A small port so the tests can point the real SDK client at a local fake server,
 * and so preview and report rendering run with nothing installed. The SDK is
 * imported lazily for that reason.
 *
 * The API key goes out on every request the client makes, so the base URL is
 * checked before the client is built. HTTPS anywhere, plain HTTP only on loopback
 * so the local fake works. Nothing else gets the credential.
 */

import { ConfigError } from "./config.js";
import type { CallSnapshot, JsonSchema } from "./types.js";

export interface CreateCallInput {
  task: string;
  recipients: { phones: string[]; region?: string; locale?: string }[];
  resultSchema: JsonSchema;
  metadata: Record<string, string>;
}

export interface CallePort {
  createCall(input: CreateCallInput, idempotencyKey: string): Promise<CallSnapshot>;
  waitForResult(callId: string, options: { timeoutMs: number; intervalMs: number }): Promise<CallSnapshot>;
  getCall(callId: string): Promise<CallSnapshot>;
}

export class CalleCallError extends Error {
  readonly code: string;
  /** The HTTP status. Null when the request never got an answer. */
  readonly status: number | null;
  /**
   * Whether this leaves the state of the call unknown. A refusal is definite: the
   * call was not created. A lost connection, a timeout or a server error is not,
   * so the call may exist and must be reconciled rather than dialled again.
   */
  readonly ambiguous: boolean;

  constructor(code: string, message: string, status: number | null = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.ambiguous = status === null || status === 408 || status === 429 || status >= 500;
  }
}

export class CalleWaitTimeout extends Error {}

export const DEFAULT_BASE_URL = "https://api.heycall-e.com";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Refuses to send the API key anywhere it should not go.
 *
 * Runs before any request that carries the credential. A warning would be no use
 * here: by the time you read it the key has already left.
 */
export function assertTrustedBaseUrl(baseUrl: string): void {
  const advice =
    "Set --base-url or CALLE_BASE_URL to an https URL. Plain http is allowed only on localhost, 127.0.0.1 or ::1 so the local fake works.";
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ConfigError(`CALL-E base URL ${baseUrl} is not a URL, so the API key was not sent. ${advice}`);
  }
  if (url.protocol === "https:") {
    return;
  }
  if (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    return;
  }
  throw new ConfigError(`CALL-E base URL ${baseUrl} is not trusted, so the API key was not sent. ${advice}`);
}

export async function createSdkPort(options: { apiKey: string; baseUrl?: string }): Promise<CallePort> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  assertTrustedBaseUrl(baseUrl);
  const { CalleClient, CalleTimeoutError } = await import("@call-e/calle");
  const client = new CalleClient({ apiKey: options.apiKey, baseUrl });

  const rethrow = (error: unknown): never => {
    if (error instanceof CalleTimeoutError) {
      throw new CalleWaitTimeout(error.message);
    }
    const value = error as { code?: string; message?: string; status?: number };
    throw new CalleCallError(
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
