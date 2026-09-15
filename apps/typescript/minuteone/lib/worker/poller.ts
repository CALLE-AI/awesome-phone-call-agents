import { sweepPendingLeads } from "./sweep";

let started = false;

/**
 * Local/submission-mode worker: an in-process poller, started once via instrumentation.ts.
 * The deployed Netlify instance uses a scheduled function instead (see netlify/functions) since
 * Netlify has no long-running process to host this loop.
 */
export function startPoller(intervalMs = 5000) {
  if (started) return;
  started = true;

  setInterval(async () => {
    try {
      await sweepPendingLeads();
    } catch (err) {
      console.error("[poller] tick failed:", err);
    }
  }, intervalMs);

  console.log(`[poller] started, polling every ${intervalMs}ms`);
}
