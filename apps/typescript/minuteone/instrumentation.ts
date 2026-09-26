/**
 * Starts the local in-process worker poller once per server instance. Skipped whenever
 * TURSO_DATABASE_URL is set — i.e. the deployed Netlify instance — where a scheduled function
 * drives dispatch instead (see netlify/functions/sweep-scheduled.ts). Note: `process.env.NETLIFY`
 * is NOT a reliable signal here — it's set during the Netlify build step but not forwarded into
 * the deployed Next.js Runtime function's actual runtime environment.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && !process.env.TURSO_DATABASE_URL) {
    const { startPoller } = await import("./lib/worker/poller");
    startPoller();
  }
}
