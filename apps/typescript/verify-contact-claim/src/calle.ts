/**
 * CALL-E access.
 *
 * The app talks to CALL-E through a small port, so the tests can point the real
 * SDK client at a local fake server and the live path stays one adapter. The SDK is
 * imported lazily, which keeps `preview` and `verify` runnable with nothing
 * installed.
 *
 * The API key goes out on every request the client makes, so the base URL is
 * checked before the client is built and before the key is read.
 */

import { ClaimError } from "./config.js";
import type { CallSnapshot, CreateCallInput } from "./types.js";

export interface WaitOptions {
  timeoutMs: number;
  intervalMs: number;
}

export interface CallePort {
  createCall(input: CreateCallInput, idempotencyKey: string): Promise<CallSnapshot>;
  waitForResult(callId: string, options: WaitOptions): Promise<CallSnapshot>;
  getCall(callId: string): Promise<CallSnapshot>;
}

export class CalleApiError extends Error {
  readonly code: string;
  readonly status: number | null;
  /**
   * True when the request may already have created a call, so this app cannot say
   * nothing happened.
   *
   * A transport failure never reached a reply. A 408 or a 5xx can land after the
   * call was accepted. A 409 on the idempotency key means a call for that key
   * exists. A 429 can throttle the reply to a request that was already taken.
   * Anything else is a status the server chose to send about a bad request, which
   * means no call was placed.
   */
  readonly ambiguous: boolean;

  constructor(code: string, message: string, status: number | null = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.ambiguous = status === null || status === 408 || status === 409 || status === 429 || status >= 500;
  }
}

export class CalleWaitTimeout extends Error {}

export const DEFAULT_BASE_URL = "https://api.heycall-e.com";

/** Hosts that may be reached over plain http, because nothing leaves the box. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** The Developer API host the SDK ships with. Trusted with no opt-in. */
export const DEFAULT_TRUSTED_HOSTS = new Set(["api.heycall-e.com"]);

function normalizeHost(value: string): string {
  return (/^\[.*\]$/.test(value) ? value.slice(1, -1) : value).toLowerCase();
}

/**
 * Read the hosts an operator named on purpose.
 *
 * Comma or space separated, exact hostnames, no port and no path. A pattern is
 * refused rather than matched literally: somebody who writes `*.example.com` means
 * it to cover subdomains and a set membership test never will, so the quiet reading
 * of that entry is the dangerous one.
 */
export function parseAllowedHosts(values: (string | undefined)[]): Set<string> {
  const hosts = new Set<string>();
  for (const value of values) {
    for (const entry of (value ?? "").split(/[\s,]+/)) {
      if (entry.length === 0) {
        continue;
      }
      const bracketed = /^\[.*\]$/.test(entry);
      const host = normalizeHost(entry);
      if (host.includes("*") || host.startsWith(".") || host.includes("/") || (!bracketed && host.includes(":"))) {
        throw new ClaimError(
          `Allowed host ${entry} is not a plain hostname. --allow-host and CALLE_ALLOWED_HOSTS take exact hostnames, one per entry, with no wildcard, port or path. Nothing was sent.`,
        );
      }
      hosts.add(host);
    }
  }
  return hosts;
}

/**
 * Refuse a base URL the API key must not travel to.
 *
 * The base URL is operator input and the key rides on every request, so this runs
 * before the key is read and before a client exists rather than after a request has
 * already handed the credential over. https on its own is not enough: it says the
 * transport is encrypted and nothing about who is on the other end, so a mistyped
 * or attacker-supplied https host is refused too. The host has to be the CALL-E API
 * host, a loopback address or one the operator named with `--allow-host` or
 * `CALLE_ALLOWED_HOSTS`. Plain http is accepted for loopback only, which is what
 * the local fake CALL-E and the tests use.
 */
export function assertTrustedBaseUrl(baseUrl: string, allowedHosts: Iterable<string> = []): URL {
  const refuse = (problem: string): never => {
    throw new ClaimError(
      `${problem} --base-url and CALLE_BASE_URL accept ${DEFAULT_BASE_URL}, a loopback address over http for a local fake or a host named in --allow-host or CALLE_ALLOWED_HOSTS. CALLE_API_KEY was not sent anywhere.`,
    );
  };
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return refuse(`${baseUrl} is not a URL.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return refuse(`${baseUrl} does not use http or https.`);
  }
  const host = normalizeHost(url.hostname);
  const loopback = LOOPBACK_HOSTS.has(host);
  if (url.protocol === "http:" && !loopback) {
    return refuse(`${baseUrl} would send CALLE_API_KEY to ${host} unencrypted.`);
  }
  if (loopback) {
    return url;
  }
  const trusted = new Set([...DEFAULT_TRUSTED_HOSTS]);
  for (const allowed of allowedHosts) {
    trusted.add(normalizeHost(allowed));
  }
  if (!trusted.has(host)) {
    return refuse(`${host} is not a trusted CALL-E host.`);
  }
  return url;
}

/**
 * Live adapter over `@call-e/calle`. The SDK is the supported server path for the
 * Developer API, so this app does not hand-roll HTTP.
 */
export async function createSdkPort(options: {
  apiKey: string;
  baseUrl?: string;
  /** Extra hosts the operator named. Everything else is refused before the key moves. */
  allowedHosts?: Iterable<string>;
}): Promise<CallePort> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  assertTrustedBaseUrl(baseUrl, options.allowedHosts ?? []);
  const { CalleClient, CalleTimeoutError } = await import("@call-e/calle");
  const client = new CalleClient({ apiKey: options.apiKey, baseUrl });

  const rethrow = (error: unknown): never => {
    if (error instanceof CalleTimeoutError) {
      throw new CalleWaitTimeout(error.message);
    }
    const value = error as { code?: string; message?: string; status?: number };
    throw new CalleApiError(
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
