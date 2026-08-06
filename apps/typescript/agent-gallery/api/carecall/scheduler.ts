import { envFromProcess, type CalleEnv } from "../_lib/calls";
import { reconcileDueSchedules, type QueueRuntimeEnv } from "../_lib/call-queue";

export const config = { runtime: "edge" };
const headers = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers });

/** Daily safety reconciliation only. Queue delivery, never cron, initiates calls at their due time. */
export async function handleScheduler(request: Request, env: CalleEnv & QueueRuntimeEnv, now = new Date()): Promise<Response> {
  if (!env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) return json({ error: "unauthorized_scheduler" }, 401);
  try {
    const results = await reconcileDueSchedules(env, now);
    return json({ reconciled: results.length, results });
  } catch {
    return json({ error: "reconciliation_not_configured" }, 503);
  }
}

export default function handler(request: Request): Promise<Response> {
  return handleScheduler(request, envFromProcess());
}
