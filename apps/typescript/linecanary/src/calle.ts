/**
 * CALL-E access.
 *
 * The engine talks to the provider through `CallePort`, so tests point it at
 * the local fake and a future second provider is one more adapter. The SDK is
 * imported lazily inside `createSdkPort`; nothing else in the app may import
 * `@call-e/calle` or open a socket.
 */

import { ConfigError } from "./config.js";
import type { CallSnapshot, JsonSchema, TranscriptTurn } from "./types.js";

export interface CreateCallInput {
  task: string;
  recipients: { phones: string[]; region?: string; locale?: string }[];
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

export class ApiError extends Error {
  readonly code: string;
  readonly status: number | null;
  /**
   * True when the request may have created a call anyway: a transport failure
   * never heard the reply, a 408/5xx can land after the create was accepted,
   * and a 409 on the idempotency key means a call for that key exists.
   */
  readonly ambiguous: boolean;

  constructor(code: string, message: string, status: number | null = null) {
    super(message);
    this.code = code;
    this.status = status;
    this.ambiguous = status === null || status === 408 || status === 409 || status >= 500;
  }
}

export class CallTimeoutError extends Error {}

export const DEFAULT_BASE_URL = "https://api.heycall-e.com";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const TRUSTED_HOSTS = new Set(["api.heycall-e.com"]);

function normalizeHost(value: string): string {
  return (/^\[.*\]$/.test(value) ? value.slice(1, -1) : value).toLowerCase();
}

/**
 * Refuse a base URL the API key must not travel to. Runs before any client is
 * built. https alone is not enough — it says nothing about who is on the
 * other end — so the host must be the CALL-E API host, loopback (plain http
 * allowed, which is what the fake uses), or one the operator explicitly
 * allowlisted. Allowlist entries are exact hostnames; a wildcard is refused
 * loudly rather than silently never matching.
 */
export function assertTrustedBaseUrl(baseUrl: string, allowedHosts: Iterable<string> = []): URL {
  const refuse = (problem: string): never => {
    throw new ConfigError(
      `${problem} Accepted: ${DEFAULT_BASE_URL}, a loopback http address for a local fake, or a host listed in CALLE_ALLOWED_HOSTS. The API key was not sent anywhere.`,
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
  if (LOOPBACK_HOSTS.has(host)) {
    return url;
  }
  if (url.protocol === "http:") {
    return refuse(`${baseUrl} would send the API key to ${host} unencrypted.`);
  }
  const trusted = new Set(TRUSTED_HOSTS);
  for (const entry of allowedHosts) {
    const allowed = normalizeHost(entry);
    if (allowed.includes("*") || allowed.startsWith(".") || allowed.includes("/")) {
      return refuse(`Allowed host ${entry} is not a plain hostname.`);
    }
    trusted.add(allowed);
  }
  if (!trusted.has(host)) {
    return refuse(`${host} is not a trusted CALL-E host.`);
  }
  return url;
}

interface SdkTurn {
  offset_seconds?: number | null;
  offsetSeconds?: number | null;
  speaker: string;
  text: string;
}

/** Normalize an SDK call object into the app-level snapshot. */
export function toSnapshot(raw: Record<string, unknown>): CallSnapshot {
  const recipients = ((raw.recipients as Record<string, unknown>[] | undefined) ?? []).map((recipient) => ({
    id: String(recipient.id ?? ""),
    phones: (recipient.phones as string[] | undefined) ?? [],
    status: String(recipient.status ?? "unknown"),
    structuredResult: (recipient.structuredResult as Record<string, unknown> | null | undefined) ?? null,
    summary: (recipient.summary as string | null | undefined) ?? null,
    attempts: ((recipient.attempts as Record<string, unknown>[] | undefined) ?? []).map((attempt) => ({
      id: String(attempt.id ?? ""),
      phone: String(attempt.phone ?? ""),
      status: String(attempt.status ?? "unknown"),
      startedAt: (attempt.startedAt as string | null | undefined) ?? null,
      completedAt: (attempt.completedAt as string | null | undefined) ?? null,
      transcriptTurns: ((attempt.transcriptTurns as SdkTurn[] | undefined) ?? []).map(
        (turn): TranscriptTurn => ({
          offsetSeconds: turn.offset_seconds ?? turn.offsetSeconds ?? null,
          speaker: turn.speaker,
          text: turn.text,
        }),
      ),
      failureCode: (attempt.failureCode as string | null | undefined) ?? null,
      failureMessage: (attempt.failureMessage as string | null | undefined) ?? null,
    })),
  }));
  return {
    id: String(raw.id ?? ""),
    status: raw.status as CallSnapshot["status"],
    task: String(raw.task ?? ""),
    recipients,
    structuredResult: (raw.structuredResult as Record<string, unknown> | null | undefined) ?? null,
    summary: (raw.summary as string | null | undefined) ?? null,
    taskCompleted: (raw.taskCompleted as boolean | null | undefined) ?? null,
    completionConfidence: (raw.completionConfidence as CallSnapshot["completionConfidence"] | undefined) ?? null,
    evidence: (raw.evidence as string[] | undefined) ?? [],
    metadata: (raw.metadata as Record<string, unknown> | undefined) ?? {},
    failureCode: (raw.failureCode as string | null | undefined) ?? null,
    failureMessage: (raw.failureMessage as string | null | undefined) ?? null,
    createdAt: String(raw.createdAt ?? ""),
    completedAt: (raw.completedAt as string | null | undefined) ?? null,
  };
}

/** Live adapter over `@call-e/calle`, the supported server path for the API. */
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
      throw new CallTimeoutError(error.message);
    }
    const value = error as { code?: string; message?: string; status?: number };
    throw new ApiError(
      value?.code ?? "sdk_error",
      value?.message ?? String(error),
      typeof value?.status === "number" ? value.status : null,
    );
  };

  return {
    async createCall(input, idempotencyKey) {
      try {
        const call = await client.calls.create(
          {
            task: input.task,
            recipients: input.recipients,
            resultSchema: input.resultSchema,
            metadata: input.metadata,
          },
          { idempotencyKey },
        );
        return toSnapshot(call as unknown as Record<string, unknown>);
      } catch (error) {
        return rethrow(error);
      }
    },
    async waitForResult(callId, waitOptions) {
      try {
        const call = await client.calls.waitForResult(callId, waitOptions);
        return toSnapshot(call as unknown as Record<string, unknown>);
      } catch (error) {
        return rethrow(error);
      }
    },
    async getCall(callId) {
      try {
        const call = await client.calls.get(callId);
        return toSnapshot(call as unknown as Record<string, unknown>);
      } catch (error) {
        return rethrow(error);
      }
    },
  };
}
