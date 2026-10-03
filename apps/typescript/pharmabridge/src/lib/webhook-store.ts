// Best-effort process-local webhook acceleration. Durable call truth remains CALL-E's API.
import type { CallView } from "./types";

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 1_000;

interface WebhookState {
  processedEventIds: Map<string, number>;
  latest: Map<string, { call: CallView; expiresAt: number }>;
}

const holder = globalThis as unknown as { __pharmabridgeWebhooks?: WebhookState };

function trim(state: WebhookState, now = Date.now()): void {
  for (const [eventId, expiresAt] of state.processedEventIds) if (expiresAt <= now) state.processedEventIds.delete(eventId);
  for (const [callId, entry] of state.latest) if (entry.expiresAt <= now) state.latest.delete(callId);
  while (state.processedEventIds.size > MAX_ENTRIES) {
    const oldest = state.processedEventIds.keys().next().value;
    if (!oldest) break;
    state.processedEventIds.delete(oldest);
  }
  while (state.latest.size > MAX_ENTRIES) {
    const oldest = state.latest.keys().next().value;
    if (!oldest) break;
    state.latest.delete(oldest);
  }
}

function state(): WebhookState {
  holder.__pharmabridgeWebhooks ??= { processedEventIds: new Map(), latest: new Map() };
  trim(holder.__pharmabridgeWebhooks);
  return holder.__pharmabridgeWebhooks;
}

export function eventProcessed(eventId: string): boolean {
  return state().processedEventIds.has(eventId);
}

export function markEventProcessed(eventId: string): void {
  const current = state();
  current.processedEventIds.set(eventId, Date.now() + TTL_MS);
  trim(current);
}

export function storeVerifiedCall(call: CallView): void {
  const current = state();
  current.latest.set(call.id, { call, expiresAt: Date.now() + TTL_MS });
  trim(current);
}

export function webhookSnapshot(callId: string): CallView | null {
  const entry = state().latest.get(callId);
  return entry?.call ?? null;
}
