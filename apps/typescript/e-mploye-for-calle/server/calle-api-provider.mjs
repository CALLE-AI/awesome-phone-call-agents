import { CalleClient } from "@call-e/calle";
import { sanitizeError } from "./safety-policy.mjs";

const asSdkInput = (body = {}) => ({
  task: body.task,
  recipients: Array.isArray(body.recipients)
    ? body.recipients.map((recipient) => ({ phones: recipient.phones, region: recipient.region, locale: recipient.locale }))
    : undefined,
  resultSchema: body.result_schema,
  recipientResultSchema: body.recipient_result_schema,
  metadata: body.metadata,
  webhookUrl: body.webhook_url,
});

const fromSdkAttempt = (attempt) => ({
  id: attempt.id,
  phone: attempt.phone,
  status: attempt.status,
  started_at: attempt.startedAt,
  completed_at: attempt.completedAt,
  summary: attempt.summary,
  transcript_turns: attempt.transcriptTurns || [],
  provider_call_id: attempt.providerCallId,
  failure_code: attempt.failureCode,
  failure_message: attempt.failureMessage,
});

const fromSdkRecipient = (recipient) => ({
  id: recipient.id,
  phones: recipient.phones,
  locale: recipient.locale,
  region: recipient.region,
  status: recipient.status,
  structured_result: recipient.structuredResult,
  summary: recipient.summary,
  attempts: (recipient.attempts || []).map(fromSdkAttempt),
});

const fromSdkCall = (call) => ({
  id: call.id,
  object: call.object,
  status: call.status,
  task: call.task,
  recipients: (call.recipients || []).map(fromSdkRecipient),
  structured_result: call.structuredResult,
  summary: call.summary,
  task_completed: call.taskCompleted,
  completion_confidence: call.completionConfidence,
  evidence: call.evidence || [],
  metadata: call.metadata || {},
  failure_code: call.failureCode,
  failure_message: call.failureMessage,
  created_at: call.createdAt,
  completed_at: call.completedAt,
});

const fromSdkEvents = (events) => ({
  object: events.object,
  data: events.data || [],
  next_cursor: events.nextCursor,
});

const sdkErrorMessage = (error) => {
  const message = error instanceof Error ? error.message : "CALL-E SDK request failed";
  const code = typeof error?.code === "string" ? error.code : "";
  return sanitizeError(code && !message.includes(code) ? `${code}: ${message}` : message);
};

export class CalleApiProvider {
  constructor({ apiKey, baseUrl, liveEnabled, fetchImpl = fetch, timeoutMs = 30000 }) {
    this.name = "live";
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.liveEnabled = liveEnabled;
    this.timeoutMs = timeoutMs;
    this.client = new CalleClient({
      apiKey,
      baseUrl,
      fetch: async (request) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          return await fetchImpl(new Request(request, { signal: controller.signal }));
        } finally {
          clearTimeout(timer);
        }
      },
    });
  }

  assertEnabled() {
    if (!this.liveEnabled) throw new Error("Live CALL-E mode is disabled");
    if (!this.apiKey) throw new Error("CALLE_API_KEY is required for live mode");
  }

  async createCall(request) {
    this.assertEnabled();
    try {
      const call = await this.client.calls.create(asSdkInput(request.body), { idempotencyKey: request.idempotencyKey });
      return fromSdkCall(call);
    } catch (error) {
      throw new Error(sdkErrorMessage(error));
    }
  }

  async getCall(id) {
    this.assertEnabled();
    try {
      return fromSdkCall(await this.client.calls.get(id));
    } catch (error) {
      throw new Error(sdkErrorMessage(error));
    }
  }

  async getEvents(id) {
    this.assertEnabled();
    try {
      return fromSdkEvents(await this.client.calls.listEvents(id));
    } catch (error) {
      throw new Error(sdkErrorMessage(error));
    }
  }

  async cancel() {
    throw new Error("CALL-E cancellation is not available in the current SDK/API contract");
  }
}
