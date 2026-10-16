import {
  CalleConnectionError,
  CalleTimeoutError,
} from "@call-e/calle";

export const CREATE_OUTCOME_UNRESOLVED = "CREATE_OUTCOME_UNRESOLVED";

function networkCode(error: unknown) {
  if (!(error instanceof Error)) return undefined;
  const cause = (error as Error & { cause?: { code?: unknown } }).cause;
  return typeof cause?.code === "string" ? cause.code : undefined;
}

export function isAcceptanceAmbiguousCreateError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const status = (error as Error & { status?: unknown }).status;
  if (typeof status === "number") {
    return (
      status === 408 ||
      status === 409 ||
      status === 429 ||
      (status >= 500 && status <= 599)
    );
  }
  return (
    error instanceof CalleConnectionError ||
    error instanceof CalleTimeoutError ||
    error instanceof TypeError ||
    Boolean(networkCode(error))
  );
}

export class CreateOutcomeUnresolvedError extends Error {
  readonly code = CREATE_OUTCOME_UNRESOLVED;
  readonly attempts: number;

  constructor(attempts: number, cause: unknown) {
    super(
      "CALL-E may have accepted the call. Automatic resubmission is disabled; review the outcome in CALL-E before another attempt.",
      { cause },
    );
    this.name = "CreateOutcomeUnresolvedError";
    this.attempts = attempts;
  }
}

export async function createCallOnce<T>(
  create: (idempotencyKey: string) => Promise<T>,
  originalIdempotencyKey: string,
): Promise<T> {
  try {
    return await create(originalIdempotencyKey);
  } catch (error) {
    if (!isAcceptanceAmbiguousCreateError(error)) throw error;
    throw new CreateOutcomeUnresolvedError(1, error);
  }
}
