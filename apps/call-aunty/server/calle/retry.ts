import { calleConfig } from "./config";
import { CalleError } from "./errors";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  retries = calleConfig.maxRetries,
) {
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return { value: await fn(attempt), retries: attempt };
    } catch (error) {
      last = error;
      if (attempt === retries) throw error;
      if (error instanceof CalleError && !error.retryable) throw error;
      const delay = Math.min(
        15_000,
        calleConfig.retryBaseMs * 2 ** attempt + Math.floor(Math.random() * 100),
      );
      await sleep(delay);
    }
  }
  throw last;
}
