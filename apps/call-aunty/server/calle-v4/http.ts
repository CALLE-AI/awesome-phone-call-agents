import { withRetry } from "./retry";
import { redact } from "./redact";
import type { CalleV4Config } from "./config";

export type HttpOptions = Pick<CalleV4Config, "baseUrl" | "apiKey" | "timeoutMs">;

function providerUrl(baseUrl: string, path: string): URL {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw Object.assign(new Error("CALL-E base URL must be absolute"), { status: 500 });
  }
  if (base.protocol !== "https:" || base.username || base.password) {
    throw Object.assign(new Error("CALL-E provider URL must be HTTPS without userinfo"), { status: 500 });
  }
  const url = new URL(path.startsWith("/") ? path : `/${path}`, base);
  if (url.origin !== base.origin) {
    throw Object.assign(new Error("CALL-E request path crossed an unexpected origin"), { status: 500 });
  }
  return url;
}

export async function calleFetch<T>(
  path: string,
  init: RequestInit,
  options: HttpOptions,
  maxRetries = 3,
): Promise<T> {
  // A create response can be lost after the provider accepted it. POST is never
  // retried automatically; only idempotent reads may use the configured retry budget.
  const retries = init.method === "POST" ? 0 : maxRetries;
  return withRetry(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    const parentSignal = init.signal;
    if (parentSignal) {
      if (parentSignal.aborted) controller.abort();
      else parentSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      };
      if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;

      const response = await fetch(providerUrl(options.baseUrl, path), {
        ...init,
        signal: controller.signal,
        headers,
        // Never follow a redirect that could receive the bearer token.
        redirect: "error",
      });
      const text = await response.text();
      const contentType = response.headers.get("content-type") ?? "";
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        if (response.ok && contentType.includes("json")) {
          const invalid = new Error("CALL-E returned invalid JSON") as Error & { status: number; body: unknown };
          invalid.status = 502;
          invalid.body = { raw: redact(text) };
          throw invalid;
        }
        body = { raw: redact(text) };
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const redirect = new Error("CALL-E redirect rejected") as Error & { status: number; body: unknown };
        redirect.status = 502;
        redirect.body = { redirect: true };
        throw redirect;
      }
      if (!response.ok) {
        const error = new Error(`CALL-E ${response.status}`) as Error & { status: number; body: unknown };
        error.status = response.status;
        error.body = body;
        throw error;
      }
      if (body && typeof body === "object" && !Array.isArray(body)) {
        const record = body as Record<string, unknown>;
        const inner = record.data;
        if (inner && typeof inner === "object" && !Array.isArray(inner)) {
          const nested = inner as Record<string, unknown>;
          if (typeof nested.id === "string" || nested.object === "call_task") return inner as T;
        }
      }
      return body as T;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        const timeout = new Error("CALL-E request timed out") as Error & { status: number; name: string };
        timeout.status = 408;
        timeout.name = "AbortError";
        throw timeout;
      }
      if (error instanceof TypeError) {
        const network = new Error("CALL-E network error") as Error & { status: number };
        network.status = 503;
        throw network;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }, retries);
}
