import { envFromProcess, handleCreateCall, storeFor, type CalleEnv } from "../_lib/calls";
import { issueTrustedOperatorSession } from "../_lib/operator-auth";
import { decryptSchedulePhone, nextOccurrence, type CareSchedule } from "../_lib/schedules";
import type { CareCallRequest } from "../../src/workflows/carecall";

export const config = { runtime: "edge" };
const headers = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers });

export async function handleScheduler(request: Request, env: CalleEnv, now = new Date()): Promise<Response> {
  if (!env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) return json({ error: "unauthorized_scheduler" }, 401);
  const store = storeFor(env);
  if (!store || !env.CARECALL_DATA_ENCRYPTION_KEY) return json({ error: "schedule_storage_not_configured" }, 503);
  const ids = await store.readDueIndex("carecall:schedules:due", now.getTime(), 20);
  const results: Array<{ schedule_id: string; state: string; call_id?: string }> = [];

  for (const id of ids) {
    const schedule = await store.get<CareSchedule>(`carecall:schedule:${id}`);
    if (!schedule || schedule.status !== "active") { await store.removeFromIndex("carecall:schedules:due", id); continue; }
    if (Date.parse(schedule.review_date) <= now.getTime()) {
      schedule.status = "needs_review"; await store.set(`carecall:schedule:${id}`, schedule); await store.removeFromIndex("carecall:schedules:due", id); results.push({ schedule_id: id, state: "review_expired" }); continue;
    }
    const sgtDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    if (schedule.skip_dates.includes(sgtDate)) {
      schedule.next_run = nextOccurrence(now, schedule.frequency, schedule.time_sgt).toISOString(); await store.set(`carecall:schedule:${id}`, schedule); await store.addToIndex("carecall:schedules:due", Date.parse(schedule.next_run), id); results.push({ schedule_id: id, state: "skipped_exception" }); continue;
    }
    try {
      const token = await issueTrustedOperatorSession(schedule.created_by, env, now.getTime());
      if (!token) {
        schedule.status = "needs_review";
        await store.set(`carecall:schedule:${id}`, schedule);
        await store.removeFromIndex("carecall:schedules:due", id);
        results.push({ schedule_id: id, state: "operator_unavailable" });
        continue;
      }
      const occurrence = schedule.next_run;
      const call: CareCallRequest = { workflow: "carecall", request_key: `${id}:${occurrence}`, organisation: schedule.organisation, senior: { ...schedule.senior, phone_e164: await decryptSchedulePhone(schedule.phone_ciphertext, env.CARECALL_DATA_ENCRYPTION_KEY), authority_confirmed: true }, routine: schedule.routine, authorization: { exactly_one_call: true, authorized_at: now.toISOString() } };
      const internalRequest = new Request("https://internal.invalid/api/calls", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(call) });
      const response = await handleCreateCall(internalRequest, env);
      const body = await response.json() as { call_id?: string };
      if (response.ok && body.call_id) {
        schedule.next_run = nextOccurrence(now, schedule.frequency, schedule.time_sgt).toISOString();
        await store.set(`carecall:schedule:${id}`, schedule);
        await store.addToIndex("carecall:schedules:due", Date.parse(schedule.next_run), id);
        results.push({ schedule_id: id, state: "started", call_id: body.call_id });
      } else {
        schedule.status = "needs_review";
        await store.set(`carecall:schedule:${id}`, schedule);
        await store.removeFromIndex("carecall:schedules:due", id);
        results.push({ schedule_id: id, state: "needs_review" });
      }
    } catch {
      schedule.status = "needs_review";
      await store.set(`carecall:schedule:${id}`, schedule);
      await store.removeFromIndex("carecall:schedules:due", id);
      results.push({ schedule_id: id, state: "needs_review" });
    }
  }
  return json({ processed: results.length, results });
}

export default function handler(request: Request): Promise<Response> {
  return handleScheduler(request, envFromProcess());
}
