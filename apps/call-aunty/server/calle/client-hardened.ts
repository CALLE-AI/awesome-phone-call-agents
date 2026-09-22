import { loadHardenedCalleConfig } from "./config-hardening";
import { CalleAuthError, CalleValidationError } from "./errors";
import {
  assertLiveExecutionAllowed,
  defaultGatewayContext,
  shouldUseMockTransport,
  type CalleExecutionContext,
} from "./live-gate";
import { getMockCall, mockCall, mockEvents } from "./mock";
import { secureCalleHttp, unwrapSecureCall, unwrapSecureEventPage } from "./http-secure";
import { CalleManualReviewError, isManualReviewError } from "./uncertain-state";
import type { CallEventPage, CallTask, CalleTransport, CreateCallRequest } from "./runtime-types";
import { assertProviderEventPageContract } from "./provider-contract";
import { fingerprintIdempotencyKey } from "./idempotency";

function isTerminal(status: string): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}

function assertCreateInput(request: CreateCallRequest): void {
  if (!request.idempotencyKey?.trim()) throw new CalleValidationError("CALL-E create requires an idempotency key");
  if (!request.task?.trim()) throw new CalleValidationError("CALL-E create requires a task");
  if (!Array.isArray(request.recipients) || request.recipients.length === 0) {
    throw new CalleValidationError("CALL-E create requires at least one recipient");
  }
}

function unknownReadError(error: unknown, id: string, operation: "read" | "events"): CalleManualReviewError {
  if (isManualReviewError(error)) return error;
  const providerStatus = error && typeof error === "object" && "status" in error
    ? Number((error as { status?: unknown }).status)
    : null;
  return new CalleManualReviewError({
    state: "unknown",
    manualReviewRequired: true,
    operation,
    callId: id,
    idempotencyKeyFingerprint: null,
    reason: "read_retries_exhausted",
    providerStatus: Number.isFinite(providerStatus) ? providerStatus : null,
    retryAttempted: false,
    remediation: "manual_review_before_retry",
  });
}

/**
 * The direct provider gateway is request-context aware. Missing a verified live context
 * always selects mock transport, and no live error can be converted into mock success.
 */
export class HardenedCalleGateway {
  private readonly config = loadHardenedCalleConfig();

  constructor(private readonly context: CalleExecutionContext = defaultGatewayContext()) {}

  private resolveTransport(): CalleTransport {
    return shouldUseMockTransport(this.context, this.config) ? "mock" : "rest";
  }

  private assertLiveOrMock(): CalleTransport {
    const transport = this.resolveTransport();
    if (transport !== "mock") assertLiveExecutionAllowed(this.context, this.config);
    return transport;
  }

  async createCall(request: CreateCallRequest): Promise<CallTask> {
    assertCreateInput(request);
    if (this.assertLiveOrMock() === "mock") return mockCall(request);
    // secureCalleHttp gives POST exactly one attempt and throws manual review if the
    // provider state may have changed after a lost or invalid response.
    const response = await secureCalleHttp<unknown>({
      method: "POST",
      path: "/v1/calls",
      idempotencyKey: request.idempotencyKey,
      body: {
        task: request.task,
        recipients: request.recipients,
        result_schema: request.resultSchema,
        recipient_result_schema: request.recipientResultSchema,
        metadata: request.metadata,
        webhook_url: request.webhookUrl,
      },
    });
    try {
      return unwrapSecureCall(response);
    } catch {
      // A 2xx response with an invalid or unfamiliar call envelope may represent an
      // accepted provider submission. Preserve the idempotency ambiguity lock instead
      // of returning a normal validation error that callers could retry blindly.
      throw new CalleManualReviewError({
        state: "unknown",
        manualReviewRequired: true,
        operation: "create",
        callId: null,
        idempotencyKeyFingerprint: fingerprintIdempotencyKey(request.idempotencyKey),
        reason: "invalid_success_payload",
        providerStatus: 200,
        retryAttempted: false,
        remediation: "manual_review_before_retry",
      });
    }
  }

  async getCall(id: string): Promise<CallTask> {
    if (!id?.trim()) throw new CalleValidationError("CALL-E get requires a call id");
    const transport = this.assertLiveOrMock();
    if (transport === "mock" || id.startsWith("call_mock_")) return getMockCall(id);
    try {
      return unwrapSecureCall(await secureCalleHttp<unknown>({ method: "GET", path: `/v1/calls/${encodeURIComponent(id)}` }));
    } catch (error) {
      if (error instanceof CalleAuthError || error instanceof CalleValidationError) throw error;
      throw unknownReadError(error, id, "read");
    }
  }

  async listEvents(id: string, cursor?: string): Promise<CallEventPage> {
    if (!id?.trim()) throw new CalleValidationError("CALL-E events require a call id");
    const transport = this.assertLiveOrMock();
    if (transport === "mock" || id.startsWith("call_mock_")) return mockEvents(id);
    const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    try {
      const page = unwrapSecureEventPage(await secureCalleHttp<unknown>({ method: "GET", path: `/v1/calls/${encodeURIComponent(id)}/events${suffix}` }));
      assertProviderEventPageContract(page);
      return page;
    } catch (error) {
      if (error instanceof CalleAuthError || error instanceof CalleValidationError) throw error;
      throw unknownReadError(error, id, "events");
    }
  }

  async createAndWait(request: CreateCallRequest): Promise<CallTask> {
    let call = await this.createCall(request);
    if (isTerminal(call.status)) return call;
    const deadline = Date.now() + this.config.pollTimeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, this.config.pollIntervalMs));
      call = await this.getCall(call.id);
      if (isTerminal(call.status)) return call;
    }
    throw new CalleManualReviewError({
      state: "unknown",
      manualReviewRequired: true,
      operation: "read",
      callId: call.id,
      idempotencyKeyFingerprint: null,
      reason: "read_retries_exhausted",
      providerStatus: null,
      retryAttempted: false,
      remediation: "manual_review_before_retry",
    });
  }
}
