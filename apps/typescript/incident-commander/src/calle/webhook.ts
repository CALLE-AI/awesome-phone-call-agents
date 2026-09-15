import type { FastifyRequest } from "fastify";
import { hasProcessedEvent, markProcessedEvent } from "../store.js";

export type CalleWebhookEvent = {
  id: string;
  type: string;
  data: unknown;
};

export async function parseCalleWebhook(
  request: FastifyRequest
): Promise<{ event: CalleWebhookEvent; duplicate: boolean } | { error: string; status: number }> {
  const event = request.body as CalleWebhookEvent;
  if (!event || typeof event !== "object" || typeof event.id !== "string") {
    return { error: "invalid_json", status: 400 };
  }
  const headerId = request.headers["call-e-event-id"];
  if (typeof headerId !== "string" || headerId !== event.id) {
    return { error: "invalid_event_id", status: 400 };
  }
  if (await hasProcessedEvent(event.id)) {
    return { event, duplicate: true };
  }
  await markProcessedEvent(event.id);
  return { event, duplicate: false };
}

export function webhookCallId(event: CalleWebhookEvent): string | null {
  if (!event.data || typeof event.data !== "object") return null;
  const data = event.data as Record<string, unknown>;
  const id = data.id ?? data.callId ?? data.call_id;
  return typeof id === "string" ? id : null;
}
