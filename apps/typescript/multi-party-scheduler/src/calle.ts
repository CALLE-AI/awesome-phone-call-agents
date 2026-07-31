/**
 * CALL-E access.
 *
 * One small port so the tests can point the real SDK client at a local fake
 * server and so `plan` and `replay` run with nothing installed. The SDK is
 * imported lazily for that reason.
 *
 * `assertTrustedBaseUrl` runs before the client exists, so no request that
 * carries the API key can be built against a host that is not trusted with it.
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
  /**
   * True when this port talks to a real CALL-E, so a call it places rings a real
   * phone. A port pointed at loopback is the local fake server or the demo. The
   * coordinator reads this to decide what it may do without durable state.
   */
  live?: boolean;
  createCall(input: CreateCallInput, idempotencyKey: string): Promise<CallSnapshot>;
  waitForResult(callId: string, options: { timeoutMs: number; intervalMs: number }): Promise<CallSnapshot>;
  getCall(callId: string): Promise<CallSnapshot>;
}

export class CalleCallError extends Error {
  readonly code: string;
  /** The HTTP status. Null when the request never got an answer at all. */
  readonly status: number | null;
  /**
   * Whether this leaves the state of the call unknown.
   *
   * A reply the server chose to send is definite: the call was not created and
   * the round can carry on. No reply, a request timeout, a rate limit, a
   * conflict on the idempotency key and a server error can each sit on top of a
   * call that was accepted, so the call may exist and has to be reconciled under
   * the same key rather than dialled again.
   *
   * The distinction only holds for the first attempt. Once one attempt is
   * ambiguous, a definite refusal on the reconciliation can be decided before
   * the idempotency lookup, so it says nothing about the request that went
   * unanswered and the call stays unresolved either way.
   */
  readonly ambiguous: boolean;

  constructor(code: string, message: string, status: number | null = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.ambiguous =
      status === null || status === 408 || status === 409 || status === 429 || status >= 500;
  }
}

export class CalleWaitTimeout extends Error {}

export const DEFAULT_BASE_URL = "https://api.heycall-e.com";

/** The CALL-E host this app talks to unless somebody opts in to another one. */
export const CALLE_HOST = "api.heycall-e.com";

/** Loopback names the local fake CALL-E can bind to. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** Lowercased and without the brackets `new URL()` leaves around an IPv6 host. */
function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

/**
 * Is this host the machine we are running on.
 *
 * Exact names only. `localhost.attacker.example` is not loopback and neither is
 * anything that merely ends in one of these.
 */
export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(normalizeHost(hostname));
}

/**
 * Every host allowed to carry the API key.
 *
 * The default list is CALL-E itself plus this machine, which is what the fake
 * server and the demo use. Anything else has to be named, in
 * `CALLE_ALLOWED_HOSTS` or with `--allow-host`. Every name is compared
 * exactly: no wildcard and no suffix match. Suffix matching is how
 * `localhost.attacker.example` gets treated as localhost.
 */
export function trustedHosts(allowHosts: string[] = []): Set<string> {
  const hosts = new Set([CALLE_HOST, ...LOOPBACK_HOSTS]);
  const named = [process.env.CALLE_ALLOWED_HOSTS ?? "", ...allowHosts].flatMap((entry) =>
    entry.split(","),
  );
  for (const entry of named) {
    const host = normalizeHost(entry.trim());
    if (host.length === 0) {
      continue;
    }
    if (/[*/\s?#]/.test(host)) {
      throw new ConfigError(
        `${entry.trim()} is not a hostname. CALLE_ALLOWED_HOSTS and --allow-host take one exact hostname each, so no wildcard and no URL.`,
      );
    }
    hosts.add(host);
  }
  return hosts;
}

function refuse(baseUrl: string, why: string): never {
  throw new ConfigError(
    `Refusing to send CALLE_API_KEY to ${baseUrl}. ${why} --base-url and CALLE_BASE_URL pick the host and only ${CALLE_HOST}, localhost, 127.0.0.1 and ::1 are trusted with the key. Name another with CALLE_ALLOWED_HOSTS or --allow-host, one exact hostname each. Nothing was sent.`,
  );
}

/**
 * Decide whether a base URL may carry the API key, before any request is made.
 *
 * Every request to CALL-E sends `Authorization: Bearer <key>`, so an arbitrary
 * base URL is a way to post the credential somewhere else. https on its own only
 * proves the wire is encrypted, not who is on the other end of it, so the host has
 * to be on the trusted list as well. Plain http is allowed only for loopback,
 * which is what the local fake server and the demo use. Anything else is refused
 * rather than warned about: the point is that the key never leaves the process.
 */
export function assertTrustedBaseUrl(baseUrl: string, allowHosts: string[] = []): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ConfigError(
      `${baseUrl} is not a URL. Set --base-url or CALLE_BASE_URL to an https URL such as ${DEFAULT_BASE_URL}.`,
    );
  }
  const host = normalizeHost(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(host))) {
    refuse(baseUrl, "Only https may carry the key. Plain http reaches this machine only.");
  }
  if (!trustedHosts(allowHosts).has(host)) {
    refuse(baseUrl, `${url.hostname} is not a trusted host.`);
  }
  return baseUrl;
}

export async function createSdkPort(options: {
  apiKey: string;
  baseUrl?: string;
  /** Hosts opted in with `--allow-host`, on top of `CALLE_ALLOWED_HOSTS`. */
  allowHosts?: string[];
}): Promise<CallePort> {
  const baseUrl = assertTrustedBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL, options.allowHosts ?? []);
  const { CalleClient, CalleTimeoutError } = await import("@call-e/calle");
  const client = new CalleClient({
    apiKey: options.apiKey,
    baseUrl,
  });

  const rethrow = (error: unknown): never => {
    if (error instanceof CalleTimeoutError) {
      throw new CalleWaitTimeout(error.message);
    }
    // `CalleAPIError` carries the status, a connection error has none, and no
    // status is what makes a failure ambiguous.
    const value = error as { code?: string; message?: string; status?: number };
    throw new CalleCallError(
      value?.code ?? "sdk_error",
      value?.message ?? String(error),
      typeof value?.status === "number" ? value.status : null,
    );
  };

  return {
    // A call through this port rings a real phone unless it is aimed at the fake
    // server on this machine.
    live: !isLoopbackHost(new URL(baseUrl).hostname),
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
