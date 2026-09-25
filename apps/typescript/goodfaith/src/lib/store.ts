// File: src/lib/store.ts
// in-memory Map; on Vercel this is best-effort per-instance (see PRD K10).
import "server-only";
import type { CallTask } from "@/lib/calle-types";

export interface RfqRecord {
  rfqId: string;
  callId: string;
  mode: "mock" | "live";
  procedure: string;
  code: string;
  clinics: { name: string; phone: string }[];
  task: CallTask | null;
  createdAt: string;
}

// Module-level singletons survive within a warm serverless instance and across dev hot-reloads.
const g = globalThis as unknown as {
  __gf_rfqs?: Map<string, RfqRecord>;
  __gf_events?: Set<string>;
};
const rfqs: Map<string, RfqRecord> = (g.__gf_rfqs ??= new Map());
const events: Set<string> = (g.__gf_events ??= new Set());

export function putRfq(rec: RfqRecord): void {
  rfqs.set(rec.rfqId, rec);
}

export function getRfq(rfqId: string): RfqRecord | undefined {
  return rfqs.get(rfqId);
}

export function updateRfqTask(rfqId: string, task: CallTask): void {
  const rec = rfqs.get(rfqId);
  if (rec) rec.task = task;
}

export function findRfqByCallId(callId: string): RfqRecord | undefined {
  for (const rec of rfqs.values()) if (rec.callId === callId) return rec;
  return undefined;
}

// Idempotency: returns true if this event id was already processed.
export function hasEvent(eventId: string): boolean {
  return events.has(eventId);
}
export function markEvent(eventId: string): void {
  events.add(eventId);
}

// The procedure code is encoded into the id so that any serverless instance can
// reconstruct the mock result from the static fixture without shared state (see PRD K10).
// Shape: rfq_<code>_<rand>. Codes are alphanumeric CPT strings (e.g. "72148").
export function newRfqId(code = "72148"): string {
  const safeCode = /^[a-z0-9]+$/i.test(code) ? code : "72148";
  return `rfq_${safeCode}_${Math.random().toString(36).slice(2, 10)}`;
}

// Recover the procedure code embedded in an rfq id; defaults to the MRI/72148 fixture
// in mock mode when the id predates encoding or is malformed.
export function codeFromRfqId(rfqId: string): string {
  const m = /^rfq_([a-z0-9]+)_/i.exec(rfqId);
  return m ? m[1] : "72148";
}
