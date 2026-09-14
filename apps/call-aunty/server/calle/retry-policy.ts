import type { CallFailureCode, CallWorkflowStatus } from "./types";

export const MAX_CALL_RETRIES = 2;

export type RetryErrorClass =
  | "retryable_transport"
  | "temporary_provider"
  | "recipient_unavailable"
  | "policy_block"
  | "malformed_request"
  | "permanent_failure"
  | "not_retriable";

export type RetryDecision = {
  canRetry: boolean;
  reason: string;
  nextAttempt: number;
  errorClass: RetryErrorClass;
  delayMs: number;
  nextStatus: "queued" | "needs_review";
};

export type RetryRandom = () => number;

export function classifyRetryError(opts: {
  status: CallWorkflowStatus;
  failureCode: CallFailureCode | null;
}): RetryErrorClass {
  if (
    opts.failureCode === "missing_consent" ||
    opts.failureCode === "urgent_state_conflict" ||
    opts.failureCode === "unsupported_region" ||
    opts.failureCode === "unsupported_language" ||
    opts.failureCode === "calls_disabled" ||
    opts.failureCode === "unauthorized"
  ) {
    return "policy_block";
  }
  if (opts.failureCode === "invalid_recipient" || opts.failureCode === "result_invalid") {
    return "malformed_request";
  }
  if (opts.failureCode === "timeout") return "retryable_transport";
  if (opts.failureCode === "provider_unavailable") return "temporary_provider";
  if (opts.status === "no_answer" || opts.failureCode === "no_answer") return "recipient_unavailable";
  if (opts.status === "failed" || opts.failureCode === "call_failed") return "temporary_provider";
  if (opts.failureCode === "cancelled" || opts.status === "cancelled") return "not_retriable";
  if (opts.status === "completed" || opts.status === "dry_run_completed") return "not_retriable";
  return "permanent_failure";
}

function backoffMs(attemptCount: number, random: RetryRandom): number {
  const base = 1_000 * 2 ** Math.max(0, attemptCount - 1);
  const jitter = Math.floor(random() * 250);
  return Math.min(30_000, base + jitter);
}

export function evaluateRetry(opts: {
  status: CallWorkflowStatus;
  failureCode: CallFailureCode | null;
  attemptCount: number;
  random?: RetryRandom;
}): RetryDecision {
  const random = opts.random ?? Math.random;
  const errorClass = classifyRetryError(opts);
  const nextAttempt = opts.attemptCount + 1;

  if (opts.attemptCount >= MAX_CALL_RETRIES) {
    return {
      canRetry: false,
      reason: "retry_exhausted",
      nextAttempt: opts.attemptCount,
      errorClass,
      delayMs: 0,
      nextStatus: "needs_review",
    };
  }

  const retriable =
    errorClass === "retryable_transport" ||
    errorClass === "temporary_provider" ||
    errorClass === "recipient_unavailable";

  if (!retriable) {
    return {
      canRetry: false,
      reason: errorClass === "policy_block" ? "policy_block" : "not_retriable",
      nextAttempt: opts.attemptCount,
      errorClass,
      delayMs: 0,
      nextStatus: "needs_review",
    };
  }

  return {
    canRetry: true,
    reason: "eligible_for_retry",
    nextAttempt,
    errorClass,
    delayMs: backoffMs(opts.attemptCount, random),
    nextStatus: "queued",
  };
}
