export const CREATE_OUTCOME_UNRESOLVED = "CREATE_OUTCOME_UNRESOLVED";

function networkCode(error: unknown) {
  if (!(error instanceof Error)) return undefined;
  const cause = (error as Error & { cause?: { code?: unknown } }).cause;
  return typeof cause?.code === "string" ? cause.code : undefined;
}

export function isAcceptanceAmbiguousHttpStatus(status: number) {
  return status === 408 || status === 409 || status === 429 || (status >= 500 && status <= 599);
}

export function isAcceptanceAmbiguousCreateError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const status = (error as Error & { status?: unknown }).status;
  if (typeof status === "number") return isAcceptanceAmbiguousHttpStatus(status);
  return (
    error.name === "CalleConnectionError" ||
    error.name === "CalleTimeoutError" ||
    error instanceof TypeError ||
    Boolean(networkCode(error))
  );
}

export class CreateOutcomeUnresolvedError extends Error {
  readonly code = CREATE_OUTCOME_UNRESOLVED;
  readonly attempts: number;

  constructor(attempts: number, cause: unknown) {
    super(
      "CALL-E may have accepted the call, but reconciliation with the original idempotency key did not resolve the outcome.",
      { cause },
    );
    this.name = "CreateOutcomeUnresolvedError";
    this.attempts = attempts;
  }
}

export async function reconcileCreateWithOriginalKey<T>(
  create: (idempotencyKey: string) => Promise<T>,
  originalIdempotencyKey: string,
  options: {
    maxAttempts?: number;
    sleep?: (ms: number) => Promise<void>;
    onRetry?: (attempt: number) => void;
  } = {},
) {
  const maxAttempts = options.maxAttempts ?? 3;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await create(originalIdempotencyKey);
    } catch (error) {
      if (!isAcceptanceAmbiguousCreateError(error)) throw error;
      if (attempt === maxAttempts) throw new CreateOutcomeUnresolvedError(attempt, error);
      options.onRetry?.(attempt);
      await sleep(attempt * 400);
    }
  }

  throw new CreateOutcomeUnresolvedError(maxAttempts, undefined);
}
