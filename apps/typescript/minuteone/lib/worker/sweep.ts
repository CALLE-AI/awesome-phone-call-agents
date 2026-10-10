import { asc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { leads } from "../db/schema";
import { dispatchLead } from "./dispatch";

/**
 * One sweep: dispatch every currently-pending lead. Shared by the local setInterval poller
 * (lib/worker/poller.ts) and the Netlify scheduled function (netlify/functions/sweep-scheduled.ts)
 * so both drive dispatchLead identically — only the trigger mechanism differs.
 */
export async function sweepPendingLeads(limit = 5): Promise<number> {
  const pending = await db
    .select({ id: leads.id })
    .from(leads)
    .where(eq(leads.status, "pending"))
    .orderBy(asc(leads.createdAt))
    .limit(limit);

  for (const lead of pending) {
    await dispatchLead(lead.id);
  }

  return pending.length;
}
