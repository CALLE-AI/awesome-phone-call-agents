import type { Caller } from "../core/calle";
import type { DispatchResult } from "../core/dispatch";
import { dispatchWave } from "../core/dispatch";
import type {
  Candidate,
  Fact,
  LineCallResult,
  SearchSpec,
  Watch,
  WatchStats,
} from "../core/types";
import { statsFromResults } from "../core/watch";
import type { Store } from "../store";
import { newWatchId } from "../store";

/**
 * Application service that owns the standing-watch lifecycle. This is the
 * seam the Next.js server actions and the scheduler call into.
 */
export interface AppDeps {
  store: Store;
  caller: Caller;
}

export interface StartWatchInput {
  spec: SearchSpec;
  candidates: Candidate[];
  targetOpen: number;
  maxCallsPerRun: number;
}

export interface WatchSummary {
  watch: Watch;
  stats: WatchStats;
  /** When the next scheduled run is, when applicable. */
  nextRunAt?: string;
}

export function createApp(deps: AppDeps) {
  return {
    /** Create a watch without dialing. The first run is triggered explicitly. */
    startWatch(input: StartWatchInput): Watch {
      const slug = input.spec.location.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const id = `watch-${slug}-${newWatchId().slice(-8)}`;
      // Idempotency keys must be unique per watch so a NEW watch never
      // collides with (and silently reuses) an older watch's call results.
      const idempotencyPrefix = `op-${id}`;
      return deps.store.createWatch({
        id,
        spec: input.spec,
        candidates: input.candidates,
        targetOpen: input.targetOpen,
        maxCallsPerRun: input.maxCallsPerRun,
        idempotencyPrefix,
      });
    },

    getWatch(id: string): Watch | null {
      return deps.store.getWatch(id);
    },

    stopWatch(id: string): boolean {
      const watch = deps.store.getWatch(id);
      if (!watch) return false;
      deps.store.updateWatchStatus(id, "stopped");
      return true;
    },

    listWatches(): WatchSummary[] {
      return deps.store.listWatches().map((watch) => {
        const stats = this.statsFor(watch);
        return { watch, stats };
      });
    },

    statsFor(watch: Watch): WatchStats {
      return statsFromResults(deps.store.getLatestResults(watch.id));
    },

    /**
     * Execute one watch run: dispatch a wave, record results, and report
     * whether a next run is scheduled.
     */
    async runWatch(id: string, runNumber: number): Promise<DispatchResult> {
      const watch = deps.store.getWatch(id);
      if (!watch) throw new Error("watch_not_found");
      if (watch.status !== "active") throw new Error("watch_not_active");

      const dispatch = await dispatchWave({
        caller: deps.caller,
        candidates: watch.candidates,
        spec: watch.spec,
        idempotencyPrefix: watch.idempotencyPrefix,
        watchId: watch.id,
        targetOpen: watch.targetOpen,
        maxCalls: watch.maxCallsPerRun,
        runKey: `run-${runNumber}`,
        isOptedOut: (phone) => deps.store.isOptedOut(phone),
        lastCalledAt: (phone) => deps.store.lastCalledAt(phone),
      });

      deps.store.recordRun(watch.id, runNumber, dispatch.results);

      if (dispatch.reason === "target_reached") {
        deps.store.updateWatchStatus(watch.id, "completed");
      }
      return dispatch;
    },

    listFacts(): Fact[] {
      return deps.store.listFacts();
    },

    getWatchRunState(watchId: string): { runCount: number; lastRunAt: string | null } {
      return deps.store.getWatchRunState(watchId);
    },

    getLatestResults(watchId: string): LineCallResult[] {
      return deps.store.getLatestResults(watchId);
    },

    optOut(phoneE164: string): void {
      deps.store.recordOptOut(phoneE164, "user_requested");
    },
  };
}

export type App = ReturnType<typeof createApp>;

export function emptyStats(): WatchStats {
  return {
    called: 0,
    reached: 0,
    open: 0,
    waitlist: 0,
    notAccepting: 0,
    ghost: 0,
    unreachable: 0,
    declined: 0,
    blocked: 0,
  };
}
