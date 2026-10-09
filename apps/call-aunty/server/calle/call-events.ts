import { z } from "zod";

export const CALL_EVENT_VERSION = "v5.0.0";

export const callEventTypeSchema = z.enum([
  "intent_created",
  "policy_decided",
  "preflight_completed",
  "provider_requested",
  "provider_status",
  "provider_failover",
  "conversation_turn",
  "tool_action",
  "outcome_extracted",
  "retry_scheduled",
  "handoff_created",
  "cancelled",
  "completed",
  "failed",
  "review_required",
]);

export type CallEventType = z.infer<typeof callEventTypeSchema>;

export const callEventSchema = z.object({
  eventVersion: z.literal(CALL_EVENT_VERSION),
  eventId: z.string().min(8).max(64),
  eventType: callEventTypeSchema,
  correlationId: z.string().min(8).max(64),
  workflowId: z.string().min(1).max(64),
  at: z.string(),
  actor: z.enum(["system", "chw", "provider", "demo", "ai"]),
  code: z.string().max(64).optional(),
  summary: z.string().max(512),
  /** Sanitized metadata — no secrets, phones, or transcripts */
  meta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

export type CallEvent = z.infer<typeof callEventSchema>;

const eventStore: CallEvent[] = [];

export function recordCallEvent(raw: Omit<CallEvent, "eventVersion">): CallEvent {
  const event = callEventSchema.parse({ ...raw, eventVersion: CALL_EVENT_VERSION });
  eventStore.push(event);
  return event;
}

export function listCallEvents(workflowId: string): CallEvent[] {
  return eventStore.filter((e) => e.workflowId === workflowId);
}

export function listEventsByCorrelation(correlationId: string): CallEvent[] {
  return eventStore.filter((e) => e.correlationId === correlationId);
}

export function resetCallEventStore() {
  eventStore.length = 0;
}

export function getCallEventStoreSize(): number {
  return eventStore.length;
}
