import { withRetry } from "./retry";
import { redact } from "./redact";
import type { CalleV4Config } from "./config";

export type HttpOptions = Pick<CalleV4Config, "baseUrl" | "apiKey" | "timeoutMs">;

export async function calleFetch<T>(
  path: string,
  init: RequestInit,
  options: HttpOptions,
  maxRetries = 3,
): Promise<T> {
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
      if (options.apiKey) {
        headers.Authorization = `Bearer ${options.apiKey}`;
      }
      const response = await fetch(`${options.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers,
      });
      const text = await response.text();
      const contentType = response.headers.get("content-type") ?? "";
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        if (response.ok && contentType.includes("json")) {
          const invalid = new Error("CALL-E returned invalid JSON") as Error & {
            status: number;
            body: unknown;
          };
          invalid.status = 502;
          invalid.body = { raw: redact(text) };
          throw invalid;
        }
        body = { raw: redact(text) };
      }
      if (!response.ok) {
        const error = new Error(`CALL-E ${response.status}`) as Error & {
          status: number;
          body: unknown;
        };
        error.status = response.status;
        error.body = body;
        throw error;
      }
      if (body && typeof body === "object" && !Array.isArray(body)) {
        const record = body as Record<string, unknown>;
        const inner = record.data;
        if (inner && typeof inner === "object" && !Array.isArray(inner)) {
          const nested = inner as Record<string, unknown>;
          if (typeof nested.id === "string" || nested.object === "call_task") {
            return inner as T;
          }
        }
      }
      return body as T;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        const timeout = new Error("CALL-E request timed out") as Error & {
          status: number;
          name: string;
        };
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
  }, maxRetries);
}
