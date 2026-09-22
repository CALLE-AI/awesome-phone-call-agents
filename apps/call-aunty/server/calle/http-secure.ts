import { calleConfig, requireCalleApiKey } from "./config";
import { loadHardenedCalleConfig } from "./config-hardening";
import {
  CalleAuthError,
  CalleNetworkError,
  CalleRateLimitError,
  CalleRemoteError,
  CalleTimeoutError,
} from "./errors";
import { withHttpMethodRetry } from "./http-retry-policy";
import { fingerprintIdempotencyKey } from "./idempotency";
import { CalleManualReviewError, type UncertainOperation } from "./uncertain-state";
import type { CallEvent, CallEventPage, CallTask } from "./runtime-types";
import { redactObject } from "./utilities";
import { assertProviderCallContract } from "./provider-contract";

function buildAbsoluteUrl(path: string): URL {
  const config = loadHardenedCalleConfig();
  let base: URL;
  try {
    base = new URL(process.env.CALLE_BASE_URL ?? calleConfig.baseUrl);
  } catch {
    throw new CalleRemoteError("CALL-E base URL must be absolute", 500);
  }
  if (base.username || base.password || base.protocol !== "https:") {
    throw new CalleRemoteError("Live CALL-E transport requires an HTTPS provider URL without userinfo", 500);
  }
  if (!config.allowedProviderOrigins.has(base.origin)) {
    throw new CalleRemoteError("CALL-E base URL is not an approved provider origin", 500);
  }
  const url = new URL(path.startsWith("/") ? path : `/${path}`, base);
  if (url.origin !== base.origin) throw new CalleRemoteError("CALL-E request path crossed an unexpected origin", 500);
  return url;
}

export function assertProviderUrlPolicy(path: string): string {
  return buildAbsoluteUrl(path).toString();
}

function operationFor(req: { method: "GET" | "POST"; path: string }): UncertainOperation {
  if (req.method === "POST") return "create";
  return req.path.includes("/events") ? "events" : "read";
}

function manualReviewForPost(
  req: { method: "GET" | "POST"; path: string; idempotencyKey?: string },
  reason: ConstructorParameters<typeof CalleManualReviewError>[0]["reason"],
  providerStatus: number | null,
): never {
  throw new CalleManualReviewError({
    state: "unknown",
    manualReviewRequired: true,
    operation: operationFor(req),
    callId: null,
    idempotencyKeyFingerprint: req.idempotencyKey ? fingerprintIdempotencyKey(req.idempotencyKey) : null,
    reason,
    providerStatus,
    retryAttempted: false,
    remediation: "manual_review_before_retry",
  });
}

function isNetworkish(error: unknown): boolean {
  return error instanceof TypeError ||
    (error instanceof Error && /failed to fetch|network|econnrefused|enotfound|econnreset|socket|redirect/i.test(error.message));
}

/**
 * Secured provider transport. POST is exactly one request; any uncertain create is
 * escalated to manual review. GET may use bounded retries because it is idempotent.
 */
export async function secureCalleHttp<T>(req: {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  idempotencyKey?: string;
}): Promise<T> {
  const config = loadHardenedCalleConfig();
  if (!config.liveCallsEnabled || config.killSwitch) {
    throw new CalleRemoteError("Live CALL-E transport is disabled", 503);
  }
  const url = buildAbsoluteUrl(req.path);

  const run = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), calleConfig.timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetch(url, {
          method: req.method,
          signal: controller.signal,
          redirect: "error",
          headers: {
            Authorization: `Bearer ${requireCalleApiKey()}`,
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(req.idempotencyKey ? { "Idempotency-Key": req.idempotencyKey } : {}),
          },
          body: req.body === undefined ? undefined : JSON.stringify(req.body),
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          if (req.method === "POST") manualReviewForPost(req, "timeout_after_submission", null);
          throw new CalleTimeoutError();
        }
        if (isNetworkish(error)) {
          if (req.method === "POST") manualReviewForPost(req, "transport_failure_after_submission", null);
          throw new CalleNetworkError(error);
        }
        throw error;
      }

      const text = await response.text();
      const contentType = response.headers.get("content-type") ?? "";
      let data: unknown;
      try {
        data = text ? JSON.parse(text) : undefined;
      } catch {
        if (req.method === "POST" && response.ok) manualReviewForPost(req, "invalid_success_payload", response.status);
        if (response.ok && contentType.includes("json")) {
          throw new CalleRemoteError("CALL-E returned invalid JSON", 502, redactObject(text));
        }
        data = text;
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (req.method === "POST") manualReviewForPost(req, "transport_failure_after_submission", response.status);
        throw new CalleRemoteError("CALL-E returned a redirect; redirects are rejected", 502, { status: response.status });
      }
      if (response.status === 401 || response.status === 403) throw new CalleAuthError();
      if (response.status === 429) throw new CalleRateLimitError(redactObject(data));
      if (!response.ok) {
        if (req.method === "POST" && response.status >= 500) {
          manualReviewForPost(req, "provider_5xx_after_submission", response.status);
        }
        throw new CalleRemoteError(`CALL-E returned HTTP ${response.status}`, response.status, redactObject(data));
      }
      if (typeof data === "string" && contentType.includes("json")) {
        if (req.method === "POST") manualReviewForPost(req, "invalid_success_payload", response.status);
        throw new CalleRemoteError("CALL-E returned invalid JSON", 502, redactObject(data));
      }
      return data as T;
    } finally {
      clearTimeout(timeout);
    }
  };

  return (await withHttpMethodRetry(run, {
    method: req.method,
    retries: req.method === "GET" ? calleConfig.maxRetries : 0,
    baseDelayMs: calleConfig.retryBaseMs,
  })).value;
}

export function unwrapSecurePayload<T>(data: unknown): T {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const inner = (data as Record<string, unknown>).data;
    if (inner && typeof inner === "object" && !Array.isArray(inner)) return inner as T;
  }
  return data as T;
}

export function unwrapSecureEventPage(data: unknown): CallEventPage {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { object: "list", data: [], next_cursor: null };
  const record = data as Record<string, unknown>;
  const cursor = (typeof record.next_cursor === "string" ? record.next_cursor : null) ?? (typeof record.nextCursor === "string" ? record.nextCursor : null);
  const dataItems = Array.isArray(record.data) ? record.data : Array.isArray(record.events) ? record.events : [];
  return { object: "list", data: dataItems as CallEvent[], next_cursor: cursor };
}

export function unwrapSecureCall(data: unknown): CallTask {
  const call = unwrapSecurePayload<CallTask>(data);
  assertProviderCallContract(call);
  return call;
}
