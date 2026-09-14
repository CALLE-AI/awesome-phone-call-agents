import type { CalleClient } from "@call-e/calle";
import { calleConfig, requireCalleApiKey } from "./config";
import { CalleAuthError, CalleTimeoutError, CalleValidationError } from "./errors";
import { calleHttp, unwrapCalleCall, unwrapCalleEventPage } from "./http";
import { getMockCall, mockCall, mockEvents } from "./mock";
import { fallbackReasonFromError, isMockCallId, isMockFallbackEligible } from "./mock-fallback";
import type {
  CallEventPage,
  CallTask,
  CalleTransport,
  CreateCallRequest,
} from "./runtime-types";

function defaultTransport(): CalleTransport {
  if (process.env.VITEST || process.env.NODE_ENV === "test" || calleConfig.mockMode || !calleConfig.apiKey) {
    return "mock";
  }
  return calleConfig.transport;
}

function fallbackEnabled() {
  return calleConfig.fallbackMock !== false;
}

export class CalleGateway {
  private sdk?: CalleClient;

  constructor(private readonly transport: CalleTransport = defaultTransport()) {}

  private async getSdk(): Promise<CalleClient> {
    if (!this.sdk) {
      const { CalleClient: SdkCalleClient } = await import("@call-e/calle");
      this.sdk = new SdkCalleClient({
        apiKey: requireCalleApiKey(),
        baseUrl: calleConfig.baseUrl,
      });
    }
    return this.sdk;
  }

  async createCall(request: CreateCallRequest): Promise<CallTask> {
    if (!request.idempotencyKey?.trim()) {
      throw new CalleValidationError("CALL-E create requires an idempotency key");
    }
    if (!request.task?.trim()) {
      throw new CalleValidationError("CALL-E create requires a task");
    }
    if (!Array.isArray(request.recipients) || request.recipients.length === 0) {
      throw new CalleValidationError("CALL-E create requires at least one recipient");
    }
    if (this.transport === "mock") return mockCall(request);
    try {
      if (this.transport === "sdk") {
        const created = await (await this.getSdk()).calls.create(
          {
            task: request.task,
            recipients: request.recipients,
            resultSchema: request.resultSchema as Record<string, unknown> | undefined,
            recipientResultSchema: request.recipientResultSchema as Record<string, unknown> | undefined,
            metadata: request.metadata,
            webhookUrl: request.webhookUrl,
          },
          { idempotencyKey: request.idempotencyKey },
        );
        return unwrapCalleCall(created);
      }
      return await calleHttp<CallTask>({
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
    } catch (error) {
      if (!isMockFallbackEligible(error, fallbackEnabled())) throw error;
      return mockCall(request, fallbackReasonFromError(error));
    }
  }

  async getCall(id: string): Promise<CallTask> {
    if (!id?.trim()) {
      throw new CalleValidationError("CALL-E get requires a call id");
    }
    if (this.transport === "mock" || isMockCallId(id)) return getMockCall(id);
    try {
      if (this.transport === "sdk") {
        return unwrapCalleCall(await (await this.getSdk()).calls.get(id));
      }
      return await calleHttp<CallTask>({
        method: "GET",
        path: `/v1/calls/${encodeURIComponent(id)}`,
      });
    } catch (error) {
      if (!isMockFallbackEligible(error, fallbackEnabled())) throw error;
      return getMockCall(id, fallbackReasonFromError(error));
    }
  }

  async listEvents(id: string, cursor?: string): Promise<CallEventPage> {
    if (!id?.trim()) {
      throw new CalleValidationError("CALL-E events require a call id");
    }
    if (this.transport === "mock" || isMockCallId(id)) return mockEvents(id);
    try {
      const page = await calleHttp<unknown>({
        method: "GET",
        path: `/v1/calls/${encodeURIComponent(id)}/events${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      });
      return unwrapCalleEventPage(page);
    } catch (error) {
      if (!isMockFallbackEligible(error, fallbackEnabled())) throw error;
      return mockEvents(id);
    }
  }

  async createAndWait(request: CreateCallRequest): Promise<CallTask> {
    let call = await this.createCall(request);
    if (["completed", "failed", "canceled"].includes(call.status)) return call;
    const deadline = Date.now() + calleConfig.pollTimeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, calleConfig.pollIntervalMs));
      try {
        call = await this.getCall(call.id);
      } catch (error) {
        if (error instanceof CalleValidationError || error instanceof CalleAuthError) throw error;
        if (Date.now() >= deadline) throw error;
      }
      if (["completed", "failed", "canceled"].includes(call.status)) return call;
    }
    throw new CalleTimeoutError();
  }
}
