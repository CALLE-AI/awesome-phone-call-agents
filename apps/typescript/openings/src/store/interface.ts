import type {
  Candidate,
  Fact,
  LineCallResult,
  SearchSpec,
  Watch,
} from "../core/types";

/**
 * Storage interface. Two implementations exist: an in-memory store for tests
 * and preview mode, and a SQLite store for the deployed app. Keeping the
 * interface here means tests never depend on a native module compiling.
 */
export interface Store {
  createWatch(input: {
    id: string;
    spec: SearchSpec;
    candidates: Candidate[];
    targetOpen: number;
    maxCallsPerRun: number;
    idempotencyPrefix: string;
  }): Watch;
  getWatch(id: string): Watch | null;
  listWatches(): Watch[];
  updateWatchStatus(id: string, status: Watch["status"]): void;
  recordRun(watchId: string, runNumber: number, results: LineCallResult[]): void;
  getWatchRunState(watchId: string): { runCount: number; lastRunAt: string | null };
  getLatestResults(watchId: string): LineCallResult[];
  recordOptOut(phoneE164: string, reason?: string): void;
  isOptedOut(phoneE164: string): boolean;
  lastCalledAt(phoneE164: string): Date | null;
  listFacts(): Fact[];
  close(): void;
}

export function newWatchId(): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `watch-${rand}`;
}
