import type { App } from "./app";
import { cadenceForRun } from "../core/watch";

/**
 * The standing-watch scheduler. Runs on the host (per Design Principle 1):
 * the host owns recurrence and the provider handles exactly one call per
 * scheduled run. One tick therefore places at most ONE provider call in
 * total — the single most-due active watch — never a loop across every due
 * watch, and never a batch.
 *
 * Decaying cadence: 1h, 3h, 7h, 14h, 24h, 48h, 72h, then weekly.
 * Cancellation is first-class: a stopped or completed watch is never re-run.
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
      // Find the single most-due active watch (oldest lastRunAt relative to
      // its cadence). runCount === 0 means the first run is user-triggered,
      // so a brand-new watch is skipped until the user presses Run now.
      let dueWatchId: string | null = null;
      let mostOverdueAt = Number.POSITIVE_INFINITY;
      for (const { watch } of app.listWatches()) {
        if (watch.status !== "active") continue;
        const { runCount, lastRunAt } = app.getWatchRunState(watch.id);
        if (runCount === 0) continue;
        const hours = cadenceForRun(runCount);
        const dueAt = lastRunAt ? new Date(lastRunAt).getTime() + hours * 3_600_000 : 0;
        if (now().getTime() >= dueAt && dueAt < mostOverdueAt) {
          mostOverdueAt = dueAt;
          dueWatchId = watch.id;
        }
      }

      if (!dueWatchId) return;

      const { runCount } = app.getWatchRunState(dueWatchId);
      await app.runScheduledOnce(dueWatchId, runCount + 1);
    } finally {
      running = false;
    }
  }

  function start(): void {
    if (timer) return;
    timer = setInterval(() => {
      void tick();
    }, intervalMs);
    // Keep the interval referenced so the standalone scheduler process stays
    // alive. An unref'd interval leaves an empty event loop, which would make
    // `node dist-scheduler/scheduler.js` exit immediately and, under the
    // container's `wait -n` CMD, take the whole app down with it.
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, tick };
}
