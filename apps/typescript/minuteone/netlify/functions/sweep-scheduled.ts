import { schedule } from "@netlify/functions";
import { sweepPendingLeads } from "../../lib/worker/sweep";

/**
 * Deployed-mode equivalent of the local setInterval poller (lib/worker/poller.ts) — Netlify
 * functions have no long-running process to host that loop, so a 1-minute cron sweep does the
 * same "dispatch every pending lead" work instead. Requires TURSO_DATABASE_URL/TURSO_AUTH_TOKEN
 * to be set (see lib/db/client.ts); an on-disk SQLite file wouldn't survive between invocations.
 */
export const handler = schedule("* * * * *", async () => {
  try {
    const dispatched = await sweepPendingLeads();
    console.log(`[sweep-scheduled] dispatched ${dispatched} lead(s)`);
  } catch (err) {
    console.error("[sweep-scheduled] sweep failed:", err);
  }

  return { statusCode: 200 };
});
