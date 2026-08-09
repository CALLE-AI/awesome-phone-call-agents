import type { App } from "./app";
import { cadenceForRun } from "../core/watch";

/**
 * The standing-watch scheduler. Runs on the host (per Design Principle 1) and
 * triggers one watch run per schedule slot. Decaying cadence: 1h, 3h, 7h,
 * 14h, 24h, 48h, 72h, then weekly. Cancellation is first-class: a stopped or
 * completed watch is never re-run.
 */
export function createScheduler(app: App, deps: { now?: () => Date; intervalMs?: number }) {
  const now = deps.now ?? (() => new Date());
  const intervalMs = deps.intervalMs ?? 60_000;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      for (const { watch } of app.listWatches()) {
        if (watch.status !== "active") continue;
        const { runCount, lastRunAt } = appStoreRunState(app, watch.id);
        if (runCount === 0) continue; // first run is user-triggered
        const hours = cadenceForRun(runCount);
        const dueAt = lastRunAt ? new Date(lastRunAt).getTime() + hours * 3_600_000 : 0;
        if (now().getTime() >= dueAt) {
          await app.runWatch(watch.id, runCount + 1);
        }
      }
    } finally {
      running = false;
    }
  }

  function start(): void {
    if (timer) return;
    timer = setInterval(() => {
      void tick();
    }, intervalMs);
    // Don't keep the process alive purely for the scheduler.
    if (typeof timer.unref === "function") timer.unref();
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, tick };
}

/** Small adapter so the scheduler does not reach into the store directly. */
function appStoreRunState(app: App, watchId: string): { runCount: number; lastRunAt: string | null } {
  // Exposed via a scheduler-specific query on the app object.
  return app.getWatchRunState(watchId);
}
