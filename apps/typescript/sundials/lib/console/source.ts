import { db, toPublicCall } from "../db.ts";
import type {
  AnalyticsSnapshot,
  DataSource,
  LeadQueueItem,
  SpeedToLeadMetrics,
  SundialCallRecord
} from "../types.ts";
import { mockCallById, mockCalls, mockCallsForVisitor, mockLeadById, mockLeads, mockMetrics } from "./fixtures/index.ts";
import { normalizeCallTranscript } from "./format.ts";
import { mockAnalytics } from "./mock-data.ts";
import { readWorkspaceSettings } from "./workspace-settings.ts";

export function readDataSource(): DataSource {
  return readWorkspaceSettings().dataSource;
}

export function resolveAnalytics(
  range?: "today" | "7d" | "30d",
  accountId?: string
): {
  analytics: AnalyticsSnapshot;
  source: DataSource;
} {
  const source = readDataSource();
  if (source === "mock") return { analytics: mockAnalytics(range || "30d"), source };
  const analytics = db.getAnalytics(range, accountId);
  return { analytics: { ...analytics, series: analytics.series ?? [] }, source };
}

export function resolveLeadQueue(accountId?: string): { leads: LeadQueueItem[]; source: DataSource } {
  const source = readDataSource();
  if (source === "mock") return { leads: mockLeads(), source };
  return { leads: db.getLeadQueue(accountId), source };
}

export function resolveAllCalls(accountId?: string): { calls: SundialCallRecord[]; source: DataSource } {
  const source = readDataSource();
  if (source === "mock") return { calls: mockCalls().map(normalizeCallTranscript), source };
  const calls = accountId
    ? db.getAllCalls().filter((call) => (call.session?.accountId || "harbor") === accountId)
    : db.getAllCalls();
  return { calls: calls.map(toPublicCall).map(normalizeCallTranscript), source };
}

export function resolveLeadDetail(
  leadId: string,
  accountId?: string
): {
  lead: LeadQueueItem | null;
  calls: SundialCallRecord[];
  source: DataSource;
} {
  const source = readDataSource();
  if (source === "mock") {
    const lead = mockLeadById(leadId) || null;
    return { lead, calls: lead ? mockCallsForVisitor(leadId).map(normalizeCallTranscript) : [], source };
  }
  const lead = db.getLeadById(leadId, accountId) || null;
  if (!lead) return { lead: null, calls: [], source };
  return { lead, calls: db.getCallsForVisitor(leadId).map(toPublicCall).map(normalizeCallTranscript), source };
}

export function resolveCallDetail(
  callId: string,
  accountId?: string
): {
  call: SundialCallRecord | null;
  lead: LeadQueueItem | null;
  source: DataSource;
} {
  const source = readDataSource();
  if (source === "mock") {
    const found = mockCallById(callId);
    const call = found ? normalizeCallTranscript(found) : null;
    const lead = call?.visitorId ? mockLeadById(call.visitorId) || null : null;
    return { call, lead, source };
  }
  const raw = db.getCall(callId);
  if (!raw) return { call: null, lead: null, source };
  if (accountId && (raw.session?.accountId || "harbor") !== accountId) {
    return { call: null, lead: null, source };
  }
  const call = normalizeCallTranscript(toPublicCall(raw));
  const lead = call.visitorId ? db.getLeadById(call.visitorId, accountId) || null : null;
  return { call, lead, source };
}

export function resolveMetrics(accountId?: string): { metrics: SpeedToLeadMetrics; source: DataSource } {
  const source = readDataSource();
  if (source === "mock") return { metrics: mockMetrics(), source };
  return { metrics: db.getMetrics(accountId), source };
}
