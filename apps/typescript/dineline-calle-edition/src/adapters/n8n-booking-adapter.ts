import { z } from "zod";

import {
  BookingDraftSchema,
  type ApprovedBookingContract,
} from "../domain/booking-contract.js";
import {
  CorrelationIdSchema,
  ExternalExecutionIdSchema,
} from "../domain/execution-context.js";
import type { BookingCallExecution } from "../services/booking-call-service.js";

export const AdapterScenarioSchema = z.enum([
  "confirmed",
  "unavailable",
  "alternative",
  "voicemail",
  "contradiction",
  "timeout",
]);

export const N8nDispatchRequestSchema = z
  .object({
    draft: BookingDraftSchema,
    approvedContractId: z.string().regex(/^[a-f0-9]{64}$/),
    correlationId: CorrelationIdSchema,
    explicitApproval: z.literal(true),
    source: z
      .object({
        n8nExecutionId: ExternalExecutionIdSchema,
        sourceCallId: ExternalExecutionIdSchema.nullable().default(null),
        toolCallId: ExternalExecutionIdSchema.nullable().default(null),
      })
      .strict(),
    scenario: AdapterScenarioSchema.default("confirmed"),
  })
  .strict();

export type N8nDispatchRequest = z.output<typeof N8nDispatchRequestSchema>;

export function serializeN8nDispatchResponse(
  input: N8nDispatchRequest,
  contract: ApprovedBookingContract,
  providerName: string,
  execution: BookingCallExecution,
) {
  if (execution.kind === "duplicate_blocked") {
    return {
      adapterVersion: "1.0",
      correlationId: execution.correlationId,
      contractId: contract.contractId,
      idempotencyKey: contract.idempotencyKey,
      state: execution.state,
      source: input.source,
      provider: {
        name: providerName,
        callId: null,
      },
      retryPolicy: {
        automaticRetryAllowed: false,
        reason: "The approved booking fingerprint already has a journal record.",
      },
      bookingResult: {
        status: "duplicate_blocked",
        messageToCaller:
          "This exact reservation was already attempted, so DineLine did not place another call.",
        needsHumanReview: execution.state === "dispatch_unknown",
        confirmationCode: null,
        alternativeDate: null,
        alternativeTime: null,
        evidence: [],
      },
    };
  }

  const outcome = execution.outcome;
  const dispatchUnknown = execution.kind === "dispatch_unknown";

  return {
    adapterVersion: "1.0",
    correlationId: execution.correlationId,
    contractId: contract.contractId,
    idempotencyKey: contract.idempotencyKey,
    state: execution.state,
    source: input.source,
    provider: {
      name: providerName,
      callId: outcome.providerCallId,
    },
    retryPolicy: {
      automaticRetryAllowed: false,
      reason: dispatchUnknown
        ? "CALL-E may have started the call; reconcile the existing execution instead of retrying."
        : "Every approved booking contract permits at most one provider dispatch.",
    },
    bookingResult: {
      status: dispatchUnknown ? "dispatch_unknown" : mapOutcomeStatus(outcome.outcome),
      messageToCaller: dispatchUnknown
        ? "The booking call may have started, but DineLine did not receive a trustworthy outcome. Your reservation is not confirmed, and the call will not be retried automatically."
        : messageForOutcome(contract, outcome.outcome, outcome.alternativeTime),
      needsHumanReview: outcome.needsHumanReview,
      confirmationCode: outcome.confirmationCode,
      alternativeDate: outcome.alternativeDate,
      alternativeTime: outcome.alternativeTime,
      evidence: outcome.evidence,
    },
  };
}

function mapOutcomeStatus(outcome: string): string {
  const statuses: Record<string, string> = {
    confirmed: "booked",
    unavailable: "unavailable",
    alternative_offered: "alternative_time_available",
    unreached: "no_answer",
    uncertain: "needs_review",
  };
  return statuses[outcome] ?? "needs_review";
}

function messageForOutcome(
  contract: ApprovedBookingContract,
  outcome: string,
  alternativeTime: string | null,
): string {
  if (outcome === "confirmed") {
    return `Your reservation at ${contract.restaurant.name} is confirmed for ${contract.reservation.partySize} on ${contract.reservation.date} at ${contract.reservation.time}.`;
  }
  if (outcome === "unavailable") {
    return `${contract.restaurant.name} does not have the requested time. Nothing was booked.`;
  }
  if (outcome === "alternative_offered") {
    return `${contract.restaurant.name} offered ${alternativeTime ?? "another time"}. Nothing was booked without your approval.`;
  }
  if (outcome === "unreached") {
    return `DineLine did not reach ${contract.restaurant.name}, and no voicemail was left.`;
  }
  return "DineLine could not verify the restaurant's answer, so the reservation is not confirmed.";
}
