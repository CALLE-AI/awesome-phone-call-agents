import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { maskEmail, maskPhoneNumber } from "../../calle/security.ts";
import { normalizeCallTranscript } from "../format.ts";
import type { LeadQueueItem, SpeedToLeadMetrics, SundialCallRecord } from "../../types.ts";

/** Must match `catalog.ts` `FIXTURE_NOW_ISO`. Loader shifts every ISO so this instant becomes Date.now(). */
export const FIXTURE_NOW_ISO = "2026-09-05T22:00:00.000Z";

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const PRIORITY_RANK: Record<string, number> = {
  very_high: 0,
  high: 1,
  nurture: 2,
  disqualified: 3
};

const FIXTURE_DIR = join(process.cwd(), "lib", "console", "fixtures");

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as T;
}

function shiftIso(value: string, deltaMs: number): string {
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return value;
  return new Date(t + deltaMs).toISOString();
}

function walkShift(value: unknown, deltaMs: number): unknown {
  if (typeof value === "string" && ISO_RE.test(value)) return shiftIso(value, deltaMs);
  if (Array.isArray(value)) return value.map((item) => walkShift(item, deltaMs));
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      next[key] = walkShift(item, deltaMs);
    }
    return next;
  }
  return value;
}

function publicLead(lead: LeadQueueItem): LeadQueueItem {
  return {
    ...lead,
    lead: {
      ...lead.lead,
      email: lead.lead.email ? maskEmail(lead.lead.email) : undefined,
      phone: lead.lead.phone ? maskPhoneNumber(lead.lead.phone) : undefined
    }
  };
}

function publicCall(call: SundialCallRecord): SundialCallRecord {
  const phone = call.rawPhoneNumber || call.phoneNumber;
  const email = call.rawContactEmail || call.contactEmail;
  const { rawPhoneNumber: _rawPhone, rawContactEmail: _rawEmail, ...pub } = {
    ...call,
    phoneNumber: phone ? maskPhoneNumber(phone) : call.phoneNumber,
    contactEmail: email ? maskEmail(email) : call.contactEmail
  };
  void _rawPhone;
  void _rawEmail;
  return normalizeCallTranscript(pub);
}

function sortLeads(leads: LeadQueueItem[]): LeadQueueItem[] {
  return [...leads].sort((a, b) => {
    const pr = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
    if (pr !== 0) return pr;
    return b.intent.score - a.intent.score;
  });
}

function sortCalls(calls: SundialCallRecord[]): SundialCallRecord[] {
  return [...calls].sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt));
}

let cached: { leads: LeadQueueItem[]; calls: SundialCallRecord[]; stamp: string } | null = null;

function fixtureStamp(): string {
  return ["leads.json", "calls.json"]
    .map((name) => {
      try {
        return `${name}:${statSync(join(FIXTURE_DIR, name)).mtimeMs}`;
      } catch {
        return `${name}:0`;
      }
    })
    .join("|");
}

// Transcript timestamps are CALL-E offset seconds. Normalize ISO clocks to offsets
// before walkShift so fixture-clock datetimes cannot leak into the overlay.

export function loadMockQueue(): { leads: LeadQueueItem[]; calls: SundialCallRecord[] } {
  const stamp = fixtureStamp();
  if (cached && cached.stamp === stamp) return cached;
  const deltaMs = Date.now() - Date.parse(FIXTURE_NOW_ISO);
  const leads = sortLeads(
    (walkShift(loadJson<LeadQueueItem[]>("leads.json"), deltaMs) as LeadQueueItem[]).map(publicLead)
  );
  const rawCalls = loadJson<SundialCallRecord[]>("calls.json").map(normalizeCallTranscript);
  const calls = sortCalls((walkShift(rawCalls, deltaMs) as SundialCallRecord[]).map(publicCall));
  cached = { leads, calls, stamp };
  return cached;
}

export function mockLeads(): LeadQueueItem[] {
  return loadMockQueue().leads;
}

export function mockCalls(): SundialCallRecord[] {
  return loadMockQueue().calls;
}

export function mockLeadById(leadId: string): LeadQueueItem | undefined {
  return mockLeads().find((lead) => lead.visitorId === leadId);
}

export function mockCallsForVisitor(visitorId: string): SundialCallRecord[] {
  return mockCalls().filter((call) => call.visitorId === visitorId);
}

export function mockCallById(callId: string): SundialCallRecord | undefined {
  return mockCalls().find((call) => call.id === callId);
}

export function mockMetrics(): SpeedToLeadMetrics {
  const all = mockCalls();
  const completed = all.filter((call) => call.status === "completed" && call.speedToDialSec);
  const inFlight = all.filter(
    (call) => call.status === "queued" || call.status === "dialing" || call.status === "in_progress"
  );
  const avgSpeed =
    completed.length > 0
      ? completed.reduce((sum, call) => sum + (call.speedToDialSec || 0), 0) / completed.length
      : 0;
  const hotCount = all.filter(
    (call) => call.leadDossier?.intentTier === "hot" || call.opportunityProfile?.priority === "very_high"
  ).length;
  return {
    avgSpeedToDialSec: parseFloat(avgSpeed.toFixed(1)),
    totalCallsToday: all.filter((call) => Date.now() - Date.parse(call.requestedAt) <= 86_400_000).length,
    hotLeadsCount: hotCount,
    conversionRatePercent: all.length > 0 ? parseFloat(((hotCount / all.length) * 100).toFixed(1)) : 0,
    inFlightCallsCount: inFlight.length
  };
}

/** Test helper: drop the in-memory overlay so the next read re-shifts timestamps. */
export function resetMockQueueCache(): void {
  cached = null;
}
