import crypto from "node:crypto";

import { CalleGateway } from "./client";
import { CalleValidationError } from "./errors";
import {
  attachIdempotencyCallId,
  checkIdempotency,
  fingerprintPayload,
  reserveIdempotency,
} from "./idempotency";
import { validateCallPolicy } from "./api-policy";
import type { CreateCallRequest } from "./types";

const CALL_ID_PATTERN = /^call_[A-Za-z0-9_-]+$/;

export class CalleService {
  constructor(private readonly gateway = new CalleGateway()) {}

  async createCall(input: CreateCallRequest) {
    const requestId = crypto.randomUUID();
    const request = validateCallPolicy(input);
    const fingerprint = fingerprintPayload(request);
    const idempotency = checkIdempotency(input.idempotencyKey, fingerprint);
    if (idempotency.state === "conflict") {
      throw new CalleValidationError("Idempotency-Key was already used for a different request");
    }
    if (idempotency.state === "duplicate" && idempotency.callId) {
      return this.gateway.getCall(idempotency.callId);
    }
    reserveIdempotency(input.idempotencyKey, fingerprint);
    const result = await this.gateway.createCall({
      ...request,
      metadata: { ...request.metadata, request_id: requestId },
    });
    attachIdempotencyCallId(input.idempotencyKey, result.id);
    return result;
  }

  getCall(id: string) {
    if (!CALL_ID_PATTERN.test(id)) {
      throw new CalleValidationError("Invalid CALL-E call id");
    }
    return this.gateway.getCall(id);
  }

  getEvents(id: string, cursor?: string) {
    if (!CALL_ID_PATTERN.test(id)) {
      throw new CalleValidationError("Invalid CALL-E call id");
    }
    return this.gateway.listEvents(id, cursor);
  }
}
