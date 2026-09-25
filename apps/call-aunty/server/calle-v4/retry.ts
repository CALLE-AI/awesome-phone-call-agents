export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function retryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return true;
  const status = (error as { status?: number }).status;
  if (typeof status === "number") return retryableStatus(status);
  const name = (error as { name?: string }).name;
  return name === "AbortError" || name === "TypeError" || !("status" in error);
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  max = 3,
  base = 250,
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt <= max; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      last = error;
      if (attempt === max || !isRetryableError(error)) break;
      const delay = base * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
      await sleep(delay);
    }
  }
  throw last;
}
