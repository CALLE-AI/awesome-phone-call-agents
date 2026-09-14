// Append-only JSONL ledger with an in-memory projection.
//
// Every fact Canopy learns is appended as one line; nothing is ever rewritten. Replaying the
// file rebuilds the exact same state, which is what makes a crash mid-event recoverable and
// an after-action report reproducible. The dashboard subscribes to the same stream.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CallRecord, Classification, DispatchTicket, EscalationResult, HazardEvent, NextAction, Person, PersonState, Priority, TriageResult, Wave } from "./types.js";

export type LedgerEntry =
  | { type: "event.declared"; at: string; event: HazardEvent; mode: "dry-run" | "live" }
  | { type: "registry.loaded"; at: string; count: number; skipped: number; warnings: string[] }
  | { type: "person.registered"; at: string; person: Person; riskScore: number; priority: Priority; factors: string[] }
  | { type: "wave.planned"; at: string; wave: Wave }
  | { type: "wave.failed"; at: string; wave: Wave; personIds: string[]; error: string }
  | { type: "call.pending"; at: string; callId: string; personIds: string[]; reason: string }
  | { type: "call.created"; at: string; call: CallRecord; taskPreview: string }
  | { type: "call.event"; at: string; callId: string; level: string; message: string; eventId: string }
  | { type: "call.terminal"; at: string; call: CallRecord; summary: string | null; evidence: string[] }
  | { type: "person.classified"; at: string; personId: string; callId: string; classification: Classification; result: TriageResult | null; summary: string | null; evidence: string[] }
  | { type: "person.action"; at: string; personId: string; action: NextAction; dueAt: string | null }
  | { type: "escalation.completed"; at: string; personId: string; callId: string; result: EscalationResult | null; summary: string | null }
  | { type: "dispatch.created"; at: string; ticket: DispatchTicket }
  | { type: "dispatch.approved"; at: string; ticketId: string; by: string }
  | { type: "note"; at: string; level: "info" | "warning" | "error"; message: string }
  | { type: "event.closed"; at: string; reportPath: string | null };

export interface Projection {
  event: HazardEvent | null;
  mode: "dry-run" | "live" | null;
  people: Map<string, Person>;
  states: Map<string, PersonState>;
  waves: Wave[];
  /** Waves whose call task CALL-E never accepted; `resume` re-places them with the same idempotency keys. */
  failedWaves: { wave: Wave; personIds: string[]; error: string }[];
  calls: Map<string, CallRecord>;
  timeline: { at: string; message: string; level: string }[];
  dispatches: Map<string, DispatchTicket>;
  closed: boolean;
  reportPath: string | null;
}

export function emptyProjection(): Projection {
  return {
    event: null,
    mode: null,
    people: new Map(),
    states: new Map(),
    waves: [],
    failedWaves: [],
    calls: new Map(),
    timeline: [],
    dispatches: new Map(),
    closed: false,
    reportPath: null,
  };
}

export function apply(projection: Projection, entry: LedgerEntry): void {
  switch (entry.type) {
    case "event.declared":
      projection.event = entry.event;
      projection.mode = entry.mode;
      projection.timeline.push({ at: entry.at, level: "info", message: `Event declared: ${entry.event.headline} (${entry.event.area}) in ${entry.mode} mode` });
      break;
    case "registry.loaded":
      projection.timeline.push({ at: entry.at, level: entry.skipped > 0 ? "warning" : "info", message: `Registry loaded: ${entry.count} people, ${entry.skipped} rows skipped` });
      break;
    case "person.registered":
      projection.people.set(entry.person.id, entry.person);
      projection.states.set(entry.person.id, {
        personId: entry.person.id,
        riskScore: entry.riskScore,
        priority: entry.priority,
        attempts: 0,
        outcome: null,
        agentTier: null,
        reasons: [],
        lastCallId: null,
        lastResult: null,
        lastSummary: null,
        classifiedAt: null,
        nextAction: null,
        followUpDueAt: null,
        contactCalled: false,
        contactResult: null,
        evidence: [],
      });
      break;
    case "wave.planned":
      projection.waves.push(entry.wave);
      projection.timeline.push({ at: entry.at, level: "info", message: `Wave ${entry.wave.index} planned: ${entry.wave.personIds.length} people, priority ${entry.wave.priority}, attempt ${entry.wave.attempt}` });
      break;
    case "wave.failed":
      projection.failedWaves.push({ wave: entry.wave, personIds: entry.personIds, error: entry.error });
      projection.timeline.push({ at: entry.at, level: "error", message: `Wave ${entry.wave.index} (attempt ${entry.wave.attempt}) was not accepted by CALL-E: ${entry.error}` });
      break;
    case "call.pending":
      projection.timeline.push({ at: entry.at, level: "warning", message: `${entry.callId} still in progress when the run stopped (${entry.reason}); run resume to settle it` });
      break;
    case "call.created":
      projection.calls.set(entry.call.callId, entry.call);
      // A re-placed failed wave that CALL-E now accepts is no longer failed.
      projection.failedWaves = projection.failedWaves.filter((f) => !(f.wave.index === entry.call.wave && f.wave.attempt === entry.call.attempt && entry.call.kind === "wave"));
      for (const personId of entry.call.personIds) {
        const state = projection.states.get(personId);
        if (state) {
          if (entry.call.kind === "wave") {
            state.attempts += 1;
          } else {
            state.contactCalled = true;
          }
          state.lastCallId = entry.call.callId;
        }
      }
      projection.timeline.push({ at: entry.at, level: "info", message: `${entry.call.kind === "wave" ? `Wave ${entry.call.wave}` : "Escalation"} call created: ${entry.call.callId} (${entry.call.recipients.length} recipient${entry.call.recipients.length === 1 ? "" : "s"})` });
      break;
    case "call.event":
      projection.timeline.push({ at: entry.at, level: entry.level, message: `${entry.callId}: ${entry.message}` });
      break;
    case "call.terminal": {
      projection.calls.set(entry.call.callId, entry.call);
      projection.timeline.push({ at: entry.at, level: entry.call.status === "completed" ? "info" : "warning", message: `${entry.call.callId} ${entry.call.status}${entry.call.confidenceLabel ? ` (confidence ${entry.call.confidenceLabel})` : ""}` });
      break;
    }
    case "person.classified": {
      const state = projection.states.get(entry.personId);
      if (state) {
        state.outcome = entry.classification.outcome;
        state.agentTier = entry.classification.agentTier;
        state.reasons = entry.classification.reasons;
        state.lastResult = entry.result;
        state.lastSummary = entry.summary;
        state.classifiedAt = entry.at;
        state.evidence = entry.evidence;
      }
      const person = projection.people.get(entry.personId);
      projection.timeline.push({ at: entry.at, level: entry.classification.outcome === "red" ? "error" : entry.classification.outcome === "green" ? "info" : "warning", message: `${person?.name ?? entry.personId}: ${entry.classification.outcome.toUpperCase()} (${entry.classification.reasons.join("; ")})` });
      break;
    }
    case "person.action": {
      const state = projection.states.get(entry.personId);
      if (state) {
        state.nextAction = entry.action;
        state.followUpDueAt = entry.action.type === "follow-up" ? entry.dueAt : state.followUpDueAt;
      }
      break;
    }
    case "escalation.completed": {
      const state = projection.states.get(entry.personId);
      if (state) {
        state.contactResult = entry.result;
      }
      const person = projection.people.get(entry.personId);
      projection.timeline.push({ at: entry.at, level: "info", message: `Contact for ${person?.name ?? entry.personId}: ${entry.result ? `reached=${entry.result.reached}, will_check=${entry.result.will_check}, eta=${entry.result.eta_minutes}m` : "no result"}` });
      break;
    }
    case "dispatch.created":
      projection.dispatches.set(entry.ticket.id, entry.ticket);
      projection.timeline.push({ at: entry.at, level: entry.ticket.kind === "emergency_services" ? "error" : "warning", message: `Dispatch: ${entry.ticket.summary}` });
      break;
    case "dispatch.approved": {
      const ticket = projection.dispatches.get(entry.ticketId);
      if (ticket) {
        ticket.approvedAt = entry.at;
      }
      projection.timeline.push({ at: entry.at, level: "info", message: `Dispatch ${entry.ticketId} approved by ${entry.by}` });
      break;
    }
    case "note":
      projection.timeline.push({ at: entry.at, level: entry.level, message: entry.message });
      break;
    case "event.closed":
      projection.closed = true;
      projection.reportPath = entry.reportPath;
      projection.timeline.push({ at: entry.at, level: "info", message: "Event closed; after-action report written" });
      break;
    default: {
      const exhaustive: never = entry;
      return exhaustive;
    }
  }
}

export type LedgerListener = (entry: LedgerEntry) => void;

export class Ledger {
  readonly path: string;
  readonly projection: Projection = emptyProjection();
  private readonly listeners = new Set<LedgerListener>();

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      for (const line of readFileSync(path, "utf8").split("\n")) {
        if (line.trim().length === 0) {
          continue;
        }
        apply(this.projection, JSON.parse(line) as LedgerEntry);
      }
    }
  }

  append(entry: LedgerEntry): void {
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`, "utf8");
    apply(this.projection, entry);
    for (const listener of this.listeners) {
      listener(entry);
    }
  }

  note(level: "info" | "warning" | "error", message: string): void {
    this.append({ type: "note", at: new Date().toISOString(), level, message });
  }

  subscribe(listener: LedgerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  entries(): LedgerEntry[] {
    if (!existsSync(this.path)) {
      return [];
    }
    return readFileSync(this.path, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as LedgerEntry);
  }
}
