import { calleConfig, requireCalleApiKey } from "./config";
import { CalleAuthError, CalleNetworkError, CalleRateLimitError, CalleRemoteError, CalleTimeoutError } from "./errors";
import { withRetry } from "./retry";
import type { CallEvent, CallEventPage, CallTask } from "./runtime-types";
import { redactObject } from "./utilities";

export function unwrapCallePayload<T>(data: unknown): T {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    const inner = record.data;
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      const nested = inner as Record<string, unknown>;
      if (typeof nested.id === "string" || nested.object === "call_task") {
        return inner as T;
      }
    }
  }
  return data as T;
}

export function unwrapCalleEventPage(data: unknown): CallEventPage {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const cursor =
      (typeof record.next_cursor === "string" ? record.next_cursor : null) ??
      (typeof record.nextCursor === "string" ? record.nextCursor : null);
    if (Array.isArray(record.data)) {
      return { object: "list", data: record.data as CallEvent[], next_cursor: cursor };
    }
    if (Array.isArray(record.events)) {
      return { object: "list", data: record.events as CallEvent[], next_cursor: cursor };
    }
  }
  return { object: "list", data: [], next_cursor: null };
}

export function unwrapCalleCall(data: unknown): CallTask {
  return unwrapCallePayload<CallTask>(data);
}

export async function calleHttp<T>(req: {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  idempotencyKey?: string;
}): Promise<T> {
  const result = await withRetry(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), calleConfig.timeoutMs);
    try {
      const response = await fetch(`${calleConfig.baseUrl}${req.path}`, {
        method: req.method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${requireCalleApiKey()}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(req.idempotencyKey ? { "Idempotency-Key": req.idempotencyKey } : {}),
        },
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
      });
      const text = await response.text();
      const contentType = response.headers.get("content-type") ?? "";
      let data: unknown;
      try {
        data = text ? JSON.parse(text) : undefined;
      } catch {
        if (response.ok && contentType.includes("json")) {
          throw new CalleRemoteError("CALL-E returned invalid JSON", 502, redactObject(text));
        }
        data = text;
      }
      if (response.status === 401 || response.status === 403) throw new CalleAuthError();
      if (response.status === 429) throw new CalleRateLimitError(redactObject(data));
      if (!response.ok) {
        throw new CalleRemoteError(`CALL-E returned HTTP ${response.status}`, response.status, redactObject(data));
      }
      if (typeof data === "string" && contentType.includes("json")) {
        throw new CalleRemoteError("CALL-E returned invalid JSON", 502, redactObject(data));
      }
      return unwrapCallePayload<T>(data);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new CalleTimeoutError();
      if (
        error instanceof TypeError ||
        (error instanceof Error &&
          /failed to fetch|network|econnrefused|enotfound|econnreset/i.test(error.message))
      ) {
        throw new CalleNetworkError(error);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  });
  return result.value;
}
