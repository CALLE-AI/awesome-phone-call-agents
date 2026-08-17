import type {
  Candidate,
  Fact,
  LineCallResult,
  SearchSpec,
  Watch,
} from "../core/types";
import type { Store } from "./interface";

/** In-memory store used by tests and the fixture-backed demo mode. */
export class MemoryStore implements Store {
  private watches = new Map<string, Watch>();
  private optOuts = new Map<string, string>();
  private calls = new Map<string, Date>();
  private facts: Fact[] = [];
  private runCounts = new Map<string, number>();
  private lastRuns = new Map<string, string>();
  private runResults = new Map<string, LineCallResult[]>();

  createWatch(input: {
    id: string;
    spec: SearchSpec;
    candidates: Candidate[];
    targetOpen: number;
    maxCallsPerRun: number;
    idempotencyPrefix: string;
  }): Watch {
    const watch: Watch = {
      id: input.id,
      spec: input.spec,
      candidates: input.candidates,
      targetOpen: input.targetOpen,
      maxCallsPerRun: input.maxCallsPerRun,
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      idempotencyPrefix: input.idempotencyPrefix,
    };
    this.watches.set(watch.id, watch);
    return watch;
  }

  getWatch(id: string): Watch | null {
    return this.watches.get(id) ?? null;
  }

  listWatches(): Watch[] {
    return [...this.watches.values()];
  }

  updateWatchStatus(id: string, status: Watch["status"]): void {
    const watch = this.watches.get(id);
    if (!watch) return;
    watch.status = status;
    watch.updatedAt = new Date().toISOString();
  }

  recordRun(watchId: string, runNumber: number, results: LineCallResult[]): void {
    this.runCounts.set(watchId, (this.runCounts.get(watchId) ?? 0) + 1);
    this.lastRuns.set(watchId, new Date().toISOString());
    this.runResults.set(watchId, [...(this.runResults.get(watchId) ?? []), ...results]);
    for (const r of results) {
      // Cooldown is keyed by the number dialed, not the candidate id: the gate
      // at dispatch time looks a number up by phoneE164. Only actually-placed
      // calls record a timestamp; a blocked candidate was never dialed.
      if (r.verdict !== "blocked") {
        this.calls.set(r.phoneE164 ?? r.candidateId, new Date(r.completedAt));
      }
      if (r.verdict === "ghost") {
        this.facts.push({
          id: `fact-${this.facts.length}`,
          practiceId: r.candidateId,
          phoneE164: r.phoneE164 ?? r.candidateId,
          factType: "line_dead",
          value: "ghost",
          evidence: r.evidence,
          recordedAt: r.completedAt,
          sourceCallId: r.calleCallId,
        });
      }
    }
  }

  recordOptOut(phoneE164: string, reason = "user_requested"): void {
    this.optOuts.set(phoneE164, reason);
  }

  getWatchRunState(watchId: string): { runCount: number; lastRunAt: string | null } {
    return {
      runCount: this.runCounts.get(watchId) ?? 0,
      lastRunAt: this.lastRuns.get(watchId) ?? null,
    };
  }

  getLatestResults(watchId: string): LineCallResult[] {
    return this.runResults.get(watchId) ?? [];
  }

  isOptedOut(phoneE164: string): boolean {
    return this.optOuts.has(phoneE164);
  }

  lastCalledAt(phoneE164: string): Date | null {
    return this.calls.get(phoneE164) ?? null;
  }

  listFacts(): Fact[] {
    return [...this.facts];
  }

  close(): void {
    // no-op
  }
}
