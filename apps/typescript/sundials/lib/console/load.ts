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

export async function loadConsole(range?: Range, accountId?: string): Promise<ConsolePayload> {
  const source = readDataSource();
  if (source !== "mock") {
    await db.refreshLiveCalls();
    if (accountId) syncPainCatalogFromCalls(getSundialsDb(), accountId);
  }
  const { analytics } = resolveAnalytics(range, accountId);
  const { calls } = resolveAllCalls(accountId);
  const { leads } = resolveLeadQueue(accountId);
  return { calls, leads, analytics, source };
}

export async function loadLead(
  leadId: string,
  accountId?: string
): Promise<{
  lead: LeadQueueItem | null;
  calls: SundialCallRecord[];
}> {
  if (readDataSource() !== "mock") await db.refreshLiveCalls();
  const { lead, calls } = resolveLeadDetail(leadId, accountId);
  scheduleMissingBriefings(getSundialsDb(), calls);
  return { lead, calls };
}

export async function loadCall(
  callId: string,
  accountId?: string
): Promise<{
  call: SundialCallRecord | null;
  lead: LeadQueueItem | null;
}> {
  if (readDataSource() !== "mock") await db.refreshLiveCalls(callId);
  const { call, lead } = resolveCallDetail(callId, accountId);
  maybeProfile(call);
  return { call, lead };
}
