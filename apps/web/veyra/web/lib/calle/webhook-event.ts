import type { JsonObject } from "@/lib/calle/safety";

const TERMINAL_TYPES = new Set([
  "call.completed",
  "call.failed",
  "call.result_validation_failed",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class WebhookInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookInputError";
  }
}

export interface ParsedWebhookEvent {
  id: string;
  type: "call.completed" | "call.failed" | "call.result_validation_failed";
  createdAt: Date;
  call: {
    id: string;
    campaignId: string;
    contactId: string;
    callResultId: string;
    status: "completed" | "failed" | "result_validation_failed";
    capturedData: JsonObject | null;
    qualified: boolean | null;
    summary: string | null;
    transcript: string | null;
    failureCode: string | null;
    failureMessage: string | null;
    completedAt: Date;
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WebhookInputError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string, max = 240): string {
  if (typeof value !== "string" || !value || value.length > max) {
    throw new WebhookInputError(`${label} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, max: number): string | null {
  return typeof value === "string" && value ? value.slice(0, max) : null;
}

function date(value: unknown, label: string): Date {
  const parsed = typeof value === "string" ? new Date(value) : new Date(Number.NaN);
  if (!Number.isFinite(parsed.getTime())) throw new WebhookInputError(`${label} is invalid`);
  return parsed;
}

function jsonObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function renderTranscript(recipients: unknown): string | null {
  if (!Array.isArray(recipients)) return null;
  const lines: string[] = [];
  for (const recipient of recipients) {
    if (typeof recipient !== "object" || recipient === null) continue;
    const attempts = (recipient as Record<string, unknown>).attempts;
    if (!Array.isArray(attempts)) continue;
    for (const attempt of attempts) {
      if (typeof attempt !== "object" || attempt === null) continue;
      const turns = (attempt as Record<string, unknown>).transcript_turns;
      if (!Array.isArray(turns)) continue;
      for (const turn of turns) {
        if (typeof turn !== "object" || turn === null) continue;
        const item = turn as Record<string, unknown>;
        if (typeof item.text !== "string" || !item.text.trim()) continue;
        const speaker = typeof item.speaker === "string" ? item.speaker : "unknown";
        const offset = typeof item.offset_seconds === "number" ? ` ${item.offset_seconds}s` : "";
        lines.push(`[${speaker}${offset}] ${item.text.trim()}`);
      }
    }
  }
  return lines.length ? lines.join("\n").slice(0, 200_000) : null;
}

export function parseWebhookEvent(value: unknown, headerEventId: string | null): ParsedWebhookEvent {
  const event = object(value, "webhook event");
  const id = requiredString(event.id, "event.id", 160);
  if (!headerEventId || headerEventId !== id) {
    throw new WebhookInputError("CALL-E-Event-Id must match event.id");
  }
  const eventType = requiredString(event.type, "event.type", 80);
  if (!TERMINAL_TYPES.has(eventType)) throw new WebhookInputError("event.type is unsupported");
  const createdAt = date(event.created_at, "event.created_at");
  const data = object(event.data, "event.data");
  const callId = requiredString(data.id, "event.data.id", 160);
  const metadata = object(data.metadata, "event.data.metadata");
  const campaignId = requiredString(metadata.campaignId, "metadata.campaignId", 80);
  const contactId = requiredString(metadata.contactId, "metadata.contactId", 80);
  const callResultId = requiredString(metadata.veyraCallResultId, "metadata.veyraCallResultId", 80);
  if (![campaignId, contactId, callResultId].every((item) => UUID.test(item))) {
    throw new WebhookInputError("webhook correlation metadata must contain valid UUIDs");
  }

  const recipients = Array.isArray(data.recipients) ? data.recipients : [];
  const firstRecipient = recipients.length && typeof recipients[0] === "object"
    ? (recipients[0] as Record<string, unknown>)
    : null;
  const capturedData = jsonObject(data.structured_result) ??
    jsonObject(firstRecipient?.structured_result);
  const qualified = typeof capturedData?.qualified === "boolean" ? capturedData.qualified : null;
  const summary = optionalString(data.summary, 20_000) ?? optionalString(firstRecipient?.summary, 20_000);
  const completedAt = data.completed_at ? date(data.completed_at, "event.data.completed_at") : createdAt;
  const normalizedStatus = eventType.slice("call.".length) as ParsedWebhookEvent["call"]["status"];

  return {
    id,
    type: eventType as ParsedWebhookEvent["type"],
    createdAt,
    call: {
      id: callId,
      campaignId,
      contactId,
      callResultId,
      status: normalizedStatus,
      capturedData,
      qualified,
      summary,
      transcript: renderTranscript(recipients),
      failureCode:
        optionalString(data.failure_code, 160) ??
        (eventType === "call.result_validation_failed" ? "result_validation_failed" : null),
      failureMessage: optionalString(data.failure_message, 2_000),
      completedAt,
    },
  };
}
