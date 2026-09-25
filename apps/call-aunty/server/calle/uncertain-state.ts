import { CalleError } from "./errors";

export type UncertainOperation = "create" | "read" | "events";

export type ManualReviewDetails = {
  state: "unknown";
  manualReviewRequired: true;
  operation: UncertainOperation;
  callId: string | null;
  idempotencyKeyFingerprint: string | null;
  reason:
    | "transport_failure_after_submission"
    | "timeout_after_submission"
    | "provider_5xx_after_submission"
    | "invalid_success_payload"
    | "read_retries_exhausted"
    | "provider_state_unavailable";
  providerStatus: number | null;
  retryAttempted: false;
  remediation: "manual_review_before_retry";
};

/**
 * A request may have reached the provider but lost its response. This is deliberately
 * not modeled as a normal failed call: retrying could place a duplicate call.
 */
export class CalleManualReviewError extends CalleError {
  readonly manualReview = true as const;
  readonly operation: UncertainOperation;
  readonly callId: string | null;

  constructor(details: ManualReviewDetails) {
    super("CALL-E state is unknown; manual review is required before another live attempt", {
      code: "CALLE_MANUAL_REVIEW",
      status: 409,
      retryable: false,
      details,
    });
    this.name = "CalleManualReviewError";
    this.operation = details.operation;
    this.callId = details.callId;
  }
}

export function isManualReviewError(error: unknown): error is CalleManualReviewError {
  return error instanceof CalleManualReviewError ||
    (error instanceof CalleError && error.code === "CALLE_MANUAL_REVIEW");
}
