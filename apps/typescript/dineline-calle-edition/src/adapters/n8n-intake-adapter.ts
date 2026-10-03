import { z } from "zod";

import { PreferenceIntakeRequestSchema } from "../domain/dining-preferences.js";
import {
  ExternalExecutionIdSchema,
  IntakeCorrelationIdSchema,
} from "../domain/execution-context.js";
import type { PreferenceIntakeExecution } from "../services/preference-intake-service.js";

export const IntakeScenarioSchema = z.enum(["complete", "missing", "timeout"]);

export const N8nIntakeDispatchRequestSchema = z
  .object({
    request: PreferenceIntakeRequestSchema,
    approvedRequestId: z.string().regex(/^[a-f0-9]{64}$/),
    correlationId: IntakeCorrelationIdSchema,
    source: z
      .object({
        n8nExecutionId: ExternalExecutionIdSchema,
        sourceCallId: ExternalExecutionIdSchema.nullable().default(null),
        toolCallId: ExternalExecutionIdSchema.nullable().default(null),
      })
      .strict(),
    scenario: IntakeScenarioSchema.default("complete"),
  })
  .strict();

export type N8nIntakeDispatchRequest = z.output<
  typeof N8nIntakeDispatchRequestSchema
>;

export function serializeN8nIntakeResponse(
  input: N8nIntakeDispatchRequest,
  requestId: string,
  idempotencyKey: string,
  providerName: string,
  execution: PreferenceIntakeExecution,
) {
  if (execution.kind === "duplicate_blocked") {
    return {
      adapterVersion: "1.0",
      correlationId: execution.correlationId,
      requestId,
      idempotencyKey,
      state: execution.state,
      source: input.source,
      provider: { name: providerName, callId: null },
      retryPolicy: {
        automaticRetryAllowed: false,
        reason: "This preference-call request already has a journal record.",
      },
      planningResult: {
        status: "duplicate_blocked",
        messageToUser:
          "This exact preference call was already attempted, so DineLine did not call again.",
        usableForSearch: false,
        preferences: null,
        missingFields: [],
        confidence: 0,
        evidence: [],
        needsUserInput: execution.state === "dispatch_unknown",
      },
    };
  }

  const dispatchUnknown = execution.kind === "dispatch_unknown";
  const outcome = execution.outcome;
  return {
    adapterVersion: "1.0",
    correlationId: execution.correlationId,
    requestId,
    idempotencyKey,
    state: execution.state,
    source: input.source,
    provider: { name: providerName, callId: outcome.providerCallId },
    retryPolicy: {
      automaticRetryAllowed: false,
      reason: dispatchUnknown
        ? "CALL-E may have started the preference call; reconcile it instead of retrying."
        : "Every approved preference request permits at most one provider dispatch.",
    },
    planningResult: {
      status: dispatchUnknown
        ? "dispatch_unknown"
        : outcome.usableForSearch
          ? "preferences_ready"
          : "needs_input",
      messageToUser: dispatchUnknown
        ? "The preference call may have started, but DineLine did not receive a trustworthy result. Fill in the request on screen instead of calling again."
        : outcome.summary,
      usableForSearch: outcome.usableForSearch,
      preferences: outcome.preferences,
      missingFields: outcome.missingFields,
      confidence: outcome.confidence,
      evidence: outcome.evidence,
      needsUserInput: outcome.needsUserInput,
    },
  };
}
