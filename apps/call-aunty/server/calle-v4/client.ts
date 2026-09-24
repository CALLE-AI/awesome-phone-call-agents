import type { CalleCall, CalleEvent, Provider } from "./types";
import type { CalleV4Config } from "./config";
import { calleFetch } from "./http";
import type { CreateCallInput } from "./types";

export class CalleProvider implements Provider {
  constructor(private readonly cfg: CalleV4Config) {}

  async createCall(input: CreateCallInput, signal?: AbortSignal): Promise<CalleCall> {
    if (!this.cfg.apiKey) {
      throw new Error("CALLE_API_KEY is not configured");
    }
    return calleFetch<CalleCall>(
      "/v1/calls",
      {
        method: "POST",
        body: JSON.stringify({
          task: input.task,
          recipients: input.recipients,
          result_schema: input.resultSchema,
          recipient_result_schema: input.recipientResultSchema,
          metadata: input.metadata,
          webhook_url: input.webhookUrl,
        }),
        headers: { "Idempotency-Key": input.idempotencyKey },
        signal,
      },
      this.cfg,
      this.cfg.maxRetries,
    );
  }

  async getCall(id: string, signal?: AbortSignal): Promise<CalleCall> {
    if (!this.cfg.apiKey) {
      throw new Error("CALLE_API_KEY is not configured");
    }
    return calleFetch<CalleCall>(
      `/v1/calls/${encodeURIComponent(id)}`,
      { method: "GET", signal },
      this.cfg,
      this.cfg.maxRetries,
    );
  }

  async getEvents(
    id: string,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<{ events: CalleEvent[]; nextCursor?: string }> {
    if (!this.cfg.apiKey) {
      throw new Error("CALLE_API_KEY is not configured");
    }
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return calleFetch<{ events: CalleEvent[]; nextCursor?: string }>(
      `/v1/calls/${encodeURIComponent(id)}/events${query}`,
      { method: "GET", signal },
      this.cfg,
      this.cfg.maxRetries,
    );
  }
}
