/**
 * CALL-E access.
 *
 * A small port so the tests can point the real SDK client at a local fake server,
 * and so preview and report rendering run with nothing installed. The SDK is
 * imported lazily for that reason.
 *
 * The API key goes out on every request the client makes, so the base URL is
 * checked before the client is built. The host has to be CALL-E itself, loopback for
 * the local fake or a host the operator named. Everything except loopback has to
 * be https. Nothing else gets the credential.
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

/**
 * The states CALL-E is finished with, in one place so nothing can drift.
 *
 * `CallStatus` in the SDK's generated schema is `queued`, `in_progress`,
 * `completed`, `failed` or `canceled`. The SDK's own `waitForResult` returns on
 * exactly the last three. The three end of call states are listed with them because
 * a call that ended in voicemail, a busy line or no answer has ended: it is a result
 * to read, not a call still in flight.
 *
 * Anything not in this list is a call with no result yet. A call with no result
 * is not something to report an outcome from.
 */
export const TERMINAL_CALL_STATUSES: readonly string[] = [
  "completed",
  "failed",
  "canceled",
  "no_answer",
  "busy",
  "voicemail",
];

export function isTerminalCallStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && TERMINAL_CALL_STATUSES.includes(status.trim().toLowerCase());
}

export const DEFAULT_BASE_URL = "https://api.heycall-e.com";

/** The one host this app has business talking to. */
const CALLE_HOSTS = ["api.heycall-e.com"];

/** Loopback, so the fake server and the demo work. Plain http is allowed here only. */
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1"];

/** Lowercased, brackets off an IPv6 literal, port already excluded by hostname. */
function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

/**
 * Every host the key may be sent to: CALL-E, loopback and anything the operator
 * named explicitly.
 *
 * Exact hostnames only. No wildcards and no suffix matching, because
 * `localhost.attacker.example` ends in nothing this app trusts and a suffix check
 * would say it does.
 */
export function allowedHosts(extra: string[] = [], named = process.env.CALLE_ALLOWED_HOSTS): Set<string> {
  const opted = [...(named ?? "").split(","), ...extra]
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);
  return new Set([...CALLE_HOSTS, ...LOOPBACK_HOSTS, ...opted]);
}

/**
 * Refuses to send the API key anywhere it should not go.
 *
 * Runs before any request that carries the credential. A warning would be no use
 * here: by the time you read it the key has already left. `https:` on its own is not
 * enough, because that says the transport was encrypted and nothing about who is on
 * the other end, so the host has to be one this app trusts or one the operator named.
 */
export function assertTrustedBaseUrl(baseUrl: string, extra: string[] = []): void {
  const advice =
    "Set --base-url or CALLE_BASE_URL to https://api.heycall-e.com. Plain http is allowed only on localhost, 127.0.0.1 or ::1 so the local fake works. Any other host has to be named exactly, in CALLE_ALLOWED_HOSTS or with --allow-host.";
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ConfigError(`CALL-E base URL ${baseUrl} is not a URL, so the API key was not sent. ${advice}`);
  }
  const host = hostOf(url);
  if (!allowedHosts(extra).has(host)) {
    throw new ConfigError(
      `CALL-E base URL ${baseUrl} is not a host this app trusts, so the API key was not sent. ${advice}`,
    );
  }
  if (url.protocol === "https:") {
    return;
  }
  if (url.protocol === "http:" && LOOPBACK_HOSTS.includes(host)) {
    return;
  }
  throw new ConfigError(
    `CALL-E base URL ${baseUrl} does not use https, so the API key was not sent. ${advice}`,
  );
}

export async function createSdkPort(options: {
  apiKey: string;
  baseUrl?: string;
  allowHosts?: string[];
}): Promise<CallePort> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  assertTrustedBaseUrl(baseUrl, options.allowHosts ?? []);
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
