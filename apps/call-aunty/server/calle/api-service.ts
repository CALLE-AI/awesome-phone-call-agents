import crypto from "node:crypto";

import { CalleGateway } from "./client";
import { CalleValidationError } from "./errors";
import {
  attachIdempotencyCallId,
  checkIdempotency,
  fingerprintIdempotencyKey,
  fingerprintPayload,
  markIdempotencyAmbiguous,
  reserveIdempotency,
} from "./idempotency";
import { validateCallPolicy } from "./api-policy";
import type { CreateCallRequest } from "./types";
import { CalleManualReviewError, isManualReviewError } from "./uncertain-state";

const CALL_ID_PATTERN = /^call_[A-Za-z0-9_-]+$/;

type Gateway = Pick<CalleGateway, "createCall" | "getCall" | "listEvents">;

/**
 * The idempotency reservation remains ambiguous after a lost live-create response.
 * A later request with the same key is deliberately blocked instead of submitting again.
 */
export class CalleService {
  constructor(private readonly gateway: Gateway = new CalleGateway()) {}

  async createCall(input: CreateCallRequest) {
    const requestId = crypto.randomUUID();
    const request = validateCallPolicy(input);
    const fingerprint = fingerprintPayload(request);
    const idempotency = checkIdempotency(input.idempotencyKey, fingerprint);

    if (idempotency.state === "conflict") {
      throw new CalleValidationError("Idempotency-Key was already used for a different request");
    }
    if (idempotency.state === "ambiguous") {
      throw new CalleManualReviewError({
        state: "unknown",
        manualReviewRequired: true,
        operation: "create",
        callId: null,
        idempotencyKeyFingerprint: fingerprintIdempotencyKey(input.idempotencyKey),
        reason: "transport_failure_after_submission",
        providerStatus: null,
        retryAttempted: false,
        remediation: "manual_review_before_retry",
      });
    }
    if (idempotency.state === "duplicate" && idempotency.callId) {
      return this.gateway.getCall(idempotency.callId);
    }

    reserveIdempotency(input.idempotencyKey, fingerprint);
    try {
      const result = await this.gateway.createCall({
        ...request,
        metadata: { ...request.metadata, request_id: requestId },
      });
      attachIdempotencyCallId(input.idempotencyKey, result.id);
      return result;
    } catch (error) {
      if (isManualReviewError(error)) markIdempotencyAmbiguous(input.idempotencyKey, fingerprint);
      throw error;
    }
  }

  getCall(id: string) {
    if (!CALL_ID_PATTERN.test(id)) throw new CalleValidationError("Invalid CALL-E call id");
    return this.gateway.getCall(id);
  }

  getEvents(id: string, cursor?: string) {
    if (!CALL_ID_PATTERN.test(id)) throw new CalleValidationError("Invalid CALL-E call id");
    return this.gateway.listEvents(id, cursor);
  }
}
