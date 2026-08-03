/**
 * CALL-E SDK adapter for live and fake-server modes.
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
  /** Best-effort cancel when supported by the provider. */
  cancelCall?(callId: string): Promise<void>;
}

export class CalleApiError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly ambiguous: boolean;

  constructor(code: string, message: string, status: number | null = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.ambiguous = status === null || status === 408 || status === 409 || status >= 500;
  }
}

export class CalleWaitTimeout extends Error {}

export const DEFAULT_BASE_URL = "https://api.heycall-e.com";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const DEFAULT_TRUSTED_HOSTS = new Set(["api.heycall-e.com"]);

function normalizeHost(value: string): string {
  return (/^\[.*\]$/.test(value) ? value.slice(1, -1) : value).toLowerCase();
}

export function parseAllowedHosts(values: (string | undefined)[]): Set<string> {
  const hosts = new Set<string>();
  for (const value of values) {
    for (const entry of (value ?? "").split(/[\s,]+/)) {
      if (entry.length === 0) continue;
      const bracketed = /^\[.*\]$/.test(entry);
      const host = normalizeHost(entry);
      if (host.includes("*") || host.startsWith(".") || host.includes("/") || (!bracketed && host.includes(":"))) {
        throw new ConfigError(
          `Allowed host ${entry} is not a plain hostname. CALLE_ALLOWED_HOSTS takes exact hostnames only.`,
        );
      }
      hosts.add(host);
    }
  }
  return hosts;
}

export function assertTrustedBaseUrl(baseUrl: string, allowedHosts: Iterable<string> = []): URL {
  const refuse = (problem: string): never => {
    throw new ConfigError(
      `${problem} CALLE_BASE_URL accepts ${DEFAULT_BASE_URL}, loopback http for local fakes, or hosts in CALLE_ALLOWED_HOSTS. CALLE_API_KEY was not sent.`,
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
    return refuse(`${baseUrl} would send CALLE_API_KEY unencrypted.`);
  }
  if (loopback) return url;
  const trusted = new Set([...DEFAULT_TRUSTED_HOSTS]);
  for (const allowed of allowedHosts) trusted.add(normalizeHost(allowed));
  if (!trusted.has(host)) {
    return refuse(`${host} is not a trusted CALL-E host.`);
  }
  return url;
}

export async function createSdkPort(options: {
  apiKey: string;
  baseUrl?: string;
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
