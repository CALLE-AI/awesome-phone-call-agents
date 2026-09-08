import { needsGeminiProfile, scheduleBrainAfterCall, scheduleMissingBriefings, syncPainCatalogFromCalls } from "@/lib/brain/pipeline";
import { db, getSundialsDb } from "@/lib/db";
import type { AnalyticsSnapshot, DataSource, LeadQueueItem, SundialCallRecord } from "@/lib/types";
import type { Range } from "./format";
import { readDataSource, resolveAllCalls, resolveAnalytics, resolveCallDetail, resolveLeadDetail, resolveLeadQueue } from "./source.ts";

function maybeProfile(call: SundialCallRecord | null | undefined): void {
  if (call && needsGeminiProfile(call)) scheduleBrainAfterCall(getSundialsDb(), call.id);
}

export type ConsolePayload = {
  calls: SundialCallRecord[];
  leads: LeadQueueItem[];
  analytics: AnalyticsSnapshot;
  source: DataSource;
};

export async function loadConsole(range?: Range): Promise<ConsolePayload> {
  const source = readDataSource();
  if (source !== "mock") {
    await db.refreshLiveCalls();
    syncPainCatalogFromCalls(getSundialsDb());
  }
  const { analytics } = resolveAnalytics(range);
  const { calls } = resolveAllCalls();
  const { leads } = resolveLeadQueue();
  return { calls, leads, analytics, source };
}

export async function loadLead(leadId: string): Promise<{
  lead: LeadQueueItem | null;
  calls: SundialCallRecord[];
}> {
  if (readDataSource() !== "mock") await db.refreshLiveCalls();
  const { lead, calls } = resolveLeadDetail(leadId);
  scheduleMissingBriefings(getSundialsDb(), calls);
  return { lead, calls };
}

export async function loadCall(callId: string): Promise<{
  call: SundialCallRecord | null;
  lead: LeadQueueItem | null;
}> {
  if (readDataSource() !== "mock") await db.refreshLiveCalls(callId);
  const { call, lead } = resolveCallDetail(callId);
  maybeProfile(call);
  return { call, lead };
}
