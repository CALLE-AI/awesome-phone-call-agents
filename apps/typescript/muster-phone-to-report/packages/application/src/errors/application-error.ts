export type ApplicationErrorKind =
  "validation" | "idempotency_conflict" | "dependency_unavailable" | "unexpected";

export type ApplicationErrorCode =
  | "invalid_organization_id"
  | "evidence_timestamp_invalid"
  | "live_authorization_invalid"
  | "live_provider_fact_invalid"
  | "live_observation_not_simulated"
  | "audit_event_idempotency_conflict"
  | "call_attempt_idempotency_conflict"
  | "observation_profile_conflict"
  | "evidence_revision_conflict"
  | "observation_version_conflict"
  | "live_authorization_conflict"
  | "live_provider_fact_conflict"
  | "audit_repository_unavailable"
  | "live_authorization_repository_unavailable"
  | "live_provider_fact_repository_unavailable"
  | "observation_repository_unavailable"
  | "unexpected_error";

export interface SafeApplicationError {
  readonly kind: ApplicationErrorKind;
  readonly code: ApplicationErrorCode;
  readonly retryable: boolean;
}

const safeMessages: Readonly<Record<ApplicationErrorKind, string>> = Object.freeze({
  validation: "Application validation failed",
  idempotency_conflict: "Application idempotency conflict",
  dependency_unavailable: "Application dependency unavailable",
  unexpected: "Unexpected application failure",
});

export class ApplicationError extends Error implements SafeApplicationError {
  public readonly kind: ApplicationErrorKind;
  public readonly code: ApplicationErrorCode;
  public readonly retryable: boolean;

  private constructor(input: SafeApplicationError) {
    super(safeMessages[input.kind]);
    this.name = "ApplicationError";
    this.kind = input.kind;
    this.code = input.code;
    this.retryable = input.retryable;
  }

  public static validation(
    code:
      | "invalid_organization_id"
      | "evidence_timestamp_invalid"
      | "live_authorization_invalid"
      | "live_provider_fact_invalid"
      | "live_observation_not_simulated",
  ): ApplicationError {
    return new ApplicationError({ kind: "validation", code, retryable: false });
  }

  public static idempotencyConflict(
    code:
      | "audit_event_idempotency_conflict"
      | "call_attempt_idempotency_conflict"
      | "observation_profile_conflict"
      | "evidence_revision_conflict"
      | "observation_version_conflict"
      | "live_authorization_conflict"
      | "live_provider_fact_conflict",
  ): ApplicationError {
    return new ApplicationError({ kind: "idempotency_conflict", code, retryable: false });
  }

  public static dependencyUnavailable(
    code:
      | "audit_repository_unavailable"
      | "live_authorization_repository_unavailable"
      | "live_provider_fact_repository_unavailable"
      | "observation_repository_unavailable",
  ): ApplicationError {
    return new ApplicationError({ kind: "dependency_unavailable", code, retryable: true });
  }

  public static unexpected(): ApplicationError {
    return new ApplicationError({
      kind: "unexpected",
      code: "unexpected_error",
      retryable: false,
    });
  }

  public toSafeValue(): SafeApplicationError {
    return Object.freeze({
      kind: this.kind,
      code: this.code,
      retryable: this.retryable,
    });
  }
}

export function classifyApplicationError(error: unknown): SafeApplicationError {
  // Unknown failures collapse to a stable value so raw error text and attached data never cross
  // the application logging/result boundary.
  return error instanceof ApplicationError
    ? error.toSafeValue()
    : ApplicationError.unexpected().toSafeValue();
}
