import { CalleError } from "./errors";

export type HttpRetryDecision =
  | { kind: "retry"; reason: "read_is_idempotent"; delayMs: number }
  | { kind: "stop"; reason: "post_never_auto_retried" | "not_retryable" | "retries_exhausted" };

function isRetryable(error: unknown): boolean {
  return error instanceof CalleError ? error.retryable : false;
}

export function httpRetryDecision(ctx: {
  method: "GET" | "POST";
  attempt: number;
  maxRetries: number;
  baseDelayMs: number;
  error: unknown;
}): HttpRetryDecision {
  if (ctx.method === "POST") return { kind: "stop", reason: "post_never_auto_retried" };
  if (ctx.attempt >= ctx.maxRetries) return { kind: "stop", reason: "retries_exhausted" };
  if (!isRetryable(ctx.error)) return { kind: "stop", reason: "not_retryable" };
  return {
    kind: "retry",
    reason: "read_is_idempotent",
    delayMs: Math.min(15_000, ctx.baseDelayMs * 2 ** ctx.attempt + Math.floor(Math.random() * 100)),
  };
}

/** Enforces the one-and-only-one transport attempt invariant for CALL-E creates. */
export async function withHttpMethodRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: { method: "GET" | "POST"; retries: number; baseDelayMs: number; sleep?: (ms: number) => Promise<void> },
): Promise<{ value: T; attempts: number }> {
  const retries = options.method === "POST" ? 0 : Math.max(0, Math.floor(options.retries));
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let attempt = 0;
  while (true) {
    try {
      return { value: await fn(attempt), attempts: attempt + 1 };
    } catch (error) {
      const decision = httpRetryDecision({
        method: options.method,
        attempt,
        maxRetries: retries,
        baseDelayMs: options.baseDelayMs,
        error,
      });
      if (decision.kind === "stop") throw error;
      await sleep(decision.delayMs);
      attempt += 1;
    }
  }
}
