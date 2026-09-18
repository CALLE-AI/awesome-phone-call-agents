import { describeNetworkError, errorMessageFromBody, isE164Phone, parseJsonText } from "./http-json";

export type MobileCallRequest = {
  task: string;
  recipients: { phone: string; region?: string; locale?: string }[];
  idempotencyKey: string;
  resultSchema?: unknown;
  metadata?: Record<string, string>;
};

export type MobileCallTask = {
  id: string;
  status: "queued" | "in_progress" | "completed" | "failed" | "canceled";
  task: string;
  summary?: string | null;
  structured_result?: unknown;
  evidence?: string[];
  task_completed?: boolean;
  completion_confidence?: { score: number; label: string } | null;
  failure_code?: string | null;
  failure_message?: string | null;
  created_at: string;
  completed_at?: string | null;
};

export { isE164Phone };

export class MobileCalleClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    if (!this.baseUrl) {
      throw new Error("CALL-E request failed: missing API base URL");
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    } catch (error) {
      throw new Error(describeNetworkError(error, "CALL-E request failed"));
    }

    const text = await response.text();
    if (!response.ok) {
      throw new Error(errorMessageFromBody(text, response.status, "CALL-E request failed"));
    }

    const payload = parseJsonText<{ ok?: boolean; error?: string; data?: T }>(text, "CALL-E request failed");
    if (payload.ok === false) {
      throw new Error(payload.error ?? "CALL-E request failed");
    }
    if (payload.data === undefined && payload.ok !== true) {
      throw new Error(payload.error ?? "CALL-E request failed");
    }
    return payload.data as T;
  }

  createCall(input: MobileCallRequest) {
    if (!input.task.trim()) {
      throw new Error("CALL-E request failed: task is required");
    }
    if (!input.idempotencyKey.trim()) {
      throw new Error("CALL-E request failed: idempotency key is required");
    }
    if (!input.recipients.length) {
      throw new Error("CALL-E request failed: at least one recipient is required");
    }
    const invalid = input.recipients.find((recipient) => !isE164Phone(recipient.phone));
    if (invalid) {
      throw new Error("CALL-E request failed: recipient must be E.164");
    }
    return this.call<MobileCallTask>("/api/calle/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: input.task,
        recipients: input.recipients.map((recipient) => ({
          phones: [recipient.phone],
          region: recipient.region,
          locale: recipient.locale,
        })),
        idempotencyKey: input.idempotencyKey,
        resultSchema: input.resultSchema,
        metadata: input.metadata,
      }),
    });
  }

  getCall(id: string) {
    if (!id.trim()) {
      throw new Error("CALL-E request failed: call id is required");
    }
    return this.call<MobileCallTask>(`/api/calle/calls/${encodeURIComponent(id)}`);
  }

  getEvents(id: string, cursor?: string) {
    if (!id.trim()) {
      throw new Error("CALL-E request failed: call id is required");
    }
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return this.call(`/api/calle/calls/${encodeURIComponent(id)}/events${query}`);
  }
}
