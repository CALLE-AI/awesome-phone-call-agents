// Append-only JSONL ledger with an in-memory projection.
//
// Every fact Still Covered learns is appended as one line; nothing is ever rewritten. Replaying the
// file rebuilds the exact same state, which makes a crash mid-campaign recoverable and the outreach
// report reproducible. The dashboard subscribes to the same stream.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  CallRecord,
  Campaign,
  Classification,
  Enrollee,
  ExemptionCode,
  NextAction,
  PersonState,
  Priority,
  ScreeningResult,
  Wave,
  WorkItem,
} from "./types.js";

export type LedgerEntry =
  | { type: "campaign.declared"; at: string; campaign: Campaign; mode: "dry-run" | "live"; stateName: string; callerOrg: string; hoursPerMonth: number; exemptionLabels: Record<ExemptionCode, string> }
  | { type: "registry.loaded"; at: string; count: number; skipped: number; excludedNotDue: number; warnings: string[] }
  | { type: "person.registered"; at: string; person: Enrollee; priorityScore: number; priority: Priority; daysToCheck: number | null; factors: string[] }
  | { type: "person.cleared"; at: string; personId: string; kind: "exempt" | "meets"; codes: ExemptionCode[]; reason: string }
  | { type: "wave.planned"; at: string; wave: Wave }
  | { type: "wave.failed"; at: string; wave: Wave; personIds: string[]; error: string }
  | { type: "call.pending"; at: string; callId: string; personIds: string[]; reason: string }
  | { type: "call.created"; at: string; call: CallRecord; taskPreview: string }
  | { type: "call.event"; at: string; callId: string; level: string; message: string; eventId: string }
  | { type: "call.terminal"; at: string; call: CallRecord; summary: string | null; evidence: string[] }
  | { type: "person.classified"; at: string; personId: string; callId: string; classification: Classification; result: ScreeningResult | null; summary: string | null; evidence: string[] }
  | { type: "person.action"; at: string; personId: string; action: NextAction; dueAt: string | null }
  | { type: "work.created"; at: string; item: WorkItem }
  | { type: "work.reviewed"; at: string; itemId: string; by: string }
  | { type: "note"; at: string; level: "info" | "warning" | "error"; message: string }
  | { type: "campaign.closed"; at: string; reportPath: string | null };

export interface Projection {
  campaign: Campaign | null;
  mode: "dry-run" | "live" | null;
  stateName: string | null;
  callerOrg: string | null;
  hoursPerMonth: number;
  exemptionLabels: Partial<Record<ExemptionCode, string>>;
  excludedNotDue: number;
  skippedRows: number;
  people: Map<string, Enrollee>;
  states: Map<string, PersonState>;
  waves: Wave[];
  /** Waves whose call tasks CALL-E never accepted; `resume` re-places them with the same idempotency keys. */
  failedWaves: { wave: Wave; personIds: string[]; error: string }[];
  calls: Map<string, CallRecord>;
  timeline: { at: string; message: string; level: string }[];
  work: Map<string, WorkItem>;
  closed: boolean;
  reportPath: string | null;
}

export function emptyProjection(): Projection {
  return {
    campaign: null,
    mode: null,
    stateName: null,
    callerOrg: null,
    hoursPerMonth: 80,
    exemptionLabels: {},
    excludedNotDue: 0,
    skippedRows: 0,
    people: new Map(),
    states: new Map(),
    waves: [],
    failedWaves: [],
    calls: new Map(),
    timeline: [],
    work: new Map(),
    closed: false,
    reportPath: null,
  };
}

/** People who asked not to be called again, from the ledger's own work items. */
export function suppressedIds(projection: Projection): Set<string> {
  return new Set([...projection.work.values()].filter((w) => w.kind === "suppression").map((w) => w.personId));
}

const OUTCOME_LEVEL: Record<string, string> = {
  likely_exempt: "info",
  likely_meets: "info",
  cleared_by_data: "info",
  at_risk: "error",
};

export function apply(projection: Projection, entry: LedgerEntry): void {
  switch (entry.type) {
    case "campaign.declared":
      projection.campaign = entry.campaign;
      projection.mode = entry.mode;
      projection.stateName = entry.stateName;
      projection.callerOrg = entry.callerOrg;
      projection.hoursPerMonth = entry.hoursPerMonth;
      projection.exemptionLabels = entry.exemptionLabels;
      projection.timeline.push({ at: entry.at, level: "info", message: `Campaign declared: ${entry.campaign.title} (${entry.stateName}, as of ${entry.campaign.asOf}) in ${entry.mode} mode` });
      break;
    case "registry.loaded":
      projection.excludedNotDue = entry.excludedNotDue;
      projection.skippedRows = entry.skipped;
      projection.timeline.push({ at: entry.at, level: entry.skipped > 0 ? "warning" : "info", message: `Enrollee list loaded: ${entry.count} people, ${entry.skipped} rows skipped, ${entry.excludedNotDue} outside the due window` });
      break;
    case "person.registered":
      projection.people.set(entry.person.id, entry.person);
      projection.states.set(entry.person.id, {
        personId: entry.person.id,
        priorityScore: entry.priorityScore,
        priority: entry.priority,
        daysToCheck: entry.daysToCheck,
        attempts: 0,
        outcome: null,
        reasons: [],
        exemptions: [],
        agentSaid: null,
        correctionNeeded: false,
        awareBefore: null,
        wantsNavigator: null,
        preferredCallback: null,
        lastCallId: null,
        lastResult: null,
        lastSummary: null,
        classifiedAt: null,
        nextAction: null,
        followUpDueAt: null,
        evidence: [],
      });
      break;
    case "person.cleared": {
      const state = projection.states.get(entry.personId);
      if (state) {
        state.outcome = "cleared_by_data";
        state.reasons = [entry.reason];
        state.exemptions = entry.codes;
        state.classifiedAt = entry.at;
        state.nextAction = { type: "none", reason: "the state's own records already settle this person; no call needed" };
      }
      const person = projection.people.get(entry.personId);
      projection.timeline.push({ at: entry.at, level: "info", message: `${person?.name ?? entry.personId}: cleared by state data, no call (${entry.reason})` });
      break;
    }
    case "wave.planned":
      projection.waves.push(entry.wave);
      projection.timeline.push({ at: entry.at, level: "info", message: `Wave ${entry.wave.index} planned: ${entry.wave.personIds.length} people, priority ${entry.wave.priority}, attempt ${entry.wave.attempt}` });
      break;
    case "wave.failed":
      projection.failedWaves.push({ wave: entry.wave, personIds: entry.personIds, error: entry.error });
      projection.timeline.push({ at: entry.at, level: "error", message: `Wave ${entry.wave.index} (attempt ${entry.wave.attempt}): CALL-E did not accept ${entry.personIds.length} call task(s): ${entry.error}` });
      break;
    case "call.pending":
      projection.timeline.push({ at: entry.at, level: "warning", message: `${entry.callId} still in progress when the run stopped (${entry.reason}); run resume to settle it` });
      break;
    case "call.created":
      projection.calls.set(entry.call.callId, entry.call);
      // A re-placed failed wave that CALL-E now accepts is no longer failed for that person.
      projection.failedWaves = projection.failedWaves
        .map((f) => (f.wave.index === entry.call.wave && f.wave.attempt === entry.call.attempt ? { ...f, personIds: f.personIds.filter((id) => !entry.call.personIds.includes(id)) } : f))
        .filter((f) => f.personIds.length > 0);
      for (const personId of entry.call.personIds) {
        const state = projection.states.get(personId);
        if (state) {
          state.attempts += 1;
          state.lastCallId = entry.call.callId;
        }
      }
      projection.timeline.push({ at: entry.at, level: "info", message: `Wave ${entry.call.wave} call created: ${entry.call.callId} (${entry.call.recipients.map((r) => r.maskedPhone).join(", ")})` });
      break;
    case "call.event":
      projection.timeline.push({ at: entry.at, level: entry.level, message: `${entry.callId}: ${entry.message}` });
      break;
    case "call.terminal":
      projection.calls.set(entry.call.callId, entry.call);
      projection.timeline.push({ at: entry.at, level: entry.call.status === "completed" ? "info" : "warning", message: `${entry.call.callId} ${entry.call.status}${entry.call.confidenceLabel ? ` (confidence ${entry.call.confidenceLabel})` : ""}` });
      break;
    case "person.classified": {
      const state = projection.states.get(entry.personId);
      if (state) {
        state.outcome = entry.classification.outcome;
        state.reasons = entry.classification.reasons;
        state.exemptions = entry.classification.exemptions;
        state.agentSaid = entry.classification.agentSaid;
        state.correctionNeeded = state.correctionNeeded || entry.classification.correctionNeeded;
        state.lastResult = entry.result;
        state.lastSummary = entry.summary;
        state.classifiedAt = entry.at;
        state.evidence = entry.evidence;
        if (entry.result) {
          if (entry.result.aware_of_rule !== "unknown") {
            state.awareBefore = entry.result.aware_of_rule;
          }
          state.wantsNavigator = entry.result.wants_navigator;
          state.preferredCallback = entry.result.preferred_callback.trim().length > 0 ? entry.result.preferred_callback.trim() : state.preferredCallback;
        }
      }
      const person = projection.people.get(entry.personId);
      projection.timeline.push({
        at: entry.at,
        level: entry.classification.correctionNeeded ? "error" : (OUTCOME_LEVEL[entry.classification.outcome] ?? "warning"),
        message: `${person?.name ?? entry.personId}: ${entry.classification.outcome.toUpperCase().replace(/_/g, " ")} (${entry.classification.reasons.join("; ")})`,
      });
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
    case "work.created":
      projection.work.set(entry.item.id, entry.item);
      projection.timeline.push({ at: entry.at, level: entry.item.kind === "correction_call" || entry.item.highPriority ? "error" : "info", message: `Worklist: ${entry.item.summary}` });
      break;
    case "work.reviewed": {
      const item = projection.work.get(entry.itemId);
      if (item) {
        item.reviewedAt = entry.at;
      }
      projection.timeline.push({ at: entry.at, level: "info", message: `Worklist item ${entry.itemId} reviewed by ${entry.by}` });
      break;
    }
    case "note":
      projection.timeline.push({ at: entry.at, level: entry.level, message: entry.message });
      break;
    case "campaign.closed":
      projection.closed = true;
      projection.reportPath = entry.reportPath;
      projection.timeline.push({ at: entry.at, level: "info", message: "Campaign closed; outreach report written" });
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
}

/**
 * A campaign id becomes a directory name, so it is validated before it is ever joined to a path.
 *
 * The character class alone is not enough: "." and ".." are made entirely of permitted characters,
 * and either one would walk the ledger out of SC_DATA_DIR.
 */
export const CAMPAIGN_ID_RE = /^[A-Za-z0-9._-]{1,120}$/;

export function assertSafeCampaignId(id: string): string {
  if (!CAMPAIGN_ID_RE.test(id) || id === "." || id === "..") {
    throw new Error(`Campaign id ${JSON.stringify(id)} is not usable as a directory name: letters, digits, dot, dash and underscore only.`);
  }
  return id;
}
