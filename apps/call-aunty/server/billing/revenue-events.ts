import { randomUUID } from "node:crypto";

import type { RevenueEventType } from "./types";

export type RevenueEvent = {
  eventId: string;
  eventType: RevenueEventType;
  userId: number;
  orgId?: string | null;
  planId?: string;
  correlationId?: string;
  at: string;
  meta: Record<string, string | number | boolean | null>;
};

const events: RevenueEvent[] = [];

export function resetRevenueEvents() {
  events.length = 0;
}

export function recordRevenueEvent(input: {
  eventType: RevenueEventType;
  userId: number;
  orgId?: string | null;
  planId?: string;
  correlationId?: string;
  meta?: Record<string, string | number | boolean | null>;
}): RevenueEvent {
  const event: RevenueEvent = {
    eventId: randomUUID().replace(/-/g, "").slice(0, 24),
    eventType: input.eventType,
    userId: input.userId,
    orgId: input.orgId ?? null,
    planId: input.planId,
    correlationId: input.correlationId,
    at: new Date().toISOString(),
    meta: sanitizeMeta(input.meta ?? {}),
  };
  events.push(event);
  return event;
}

function sanitizeMeta(meta: Record<string, string | number | boolean | null>) {
  const blocked = ["phone", "email", "name", "note", "transcript", "womanId", "beneficiary"];
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (blocked.some((b) => k.toLowerCase().includes(b))) continue;
    clean[k] = v;
  }
  return clean;
}

export function listRevenueEvents(userId?: number): RevenueEvent[] {
  if (userId === undefined) return [...events];
  return events.filter((e) => e.userId === userId);
}

export function summarizeFunnel() {
  const counts: Partial<Record<RevenueEventType, number>> = {};
  for (const e of events) {
    counts[e.eventType] = (counts[e.eventType] ?? 0) + 1;
  }
  const viewed = counts.pricing_viewed ?? 0;
  const verified = counts.purchase_verified ?? 0;
  return {
    counts,
    conversionRate: viewed > 0 ? verified / viewed : 0,
    synthetic: true,
  };
}
