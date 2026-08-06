import { envFromProcess, storeFor } from "../_lib/calls";
import { authenticateOperator, operatorCanAccessSenior } from "../_lib/operator-auth";
import { encryptSchedulePhone, nextOccurrence, type CareSchedule, type ScheduleFrequency, type ScheduleStatus } from "../_lib/schedules";
import { isScheduledTimeWithinPermittedWindow, validateCareCallRequest, type CareCallRequest } from "../../src/workflows/carecall";

export const config = { runtime: "edge" };
const headers = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers });

export default async function handler(request: Request): Promise<Response> {
  const env = envFromProcess();
  const operator = await authenticateOperator(request, env);
  if (!operator) return json({ error: "invalid_operator_session" }, 401);
  const store = storeFor(env);
  if (!store || !env.CARECALL_DATA_ENCRYPTION_KEY) return json({ error: "schedule_storage_not_configured" }, 503);

  if (request.method === "POST") {
    let body: { call?: CareCallRequest; frequency?: ScheduleFrequency; time_sgt?: string; review_date?: string; skip_dates?: string[]; recurring_authority_confirmed?: boolean };
    try { body = await request.json() as typeof body; } catch { return json({ error: "invalid_json" }, 400); }
    if (!body.call || !body.frequency || !body.time_sgt || !body.review_date || body.recurring_authority_confirmed !== true) return json({ error: "invalid_schedule" }, 400);
    if (!operatorCanAccessSenior(operator, body.call.senior.id)) return json({ error: "senior_scope_denied" }, 403);
    const errors = validateCareCallRequest(body.call, new Date(), { enforceCurrentCallWindow: false });
    if (errors.length) return json({ error: "invalid_request", details: errors }, 400);
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(body.time_sgt) || !["daily", "weekdays"].includes(body.frequency)) return json({ error: "invalid_schedule" }, 400);
    if (!isScheduledTimeWithinPermittedWindow(body.call.senior.permitted_call_window, body.time_sgt)) return json({ error: "schedule_outside_permitted_call_window" }, 400);
    const reviewTime = Date.parse(body.review_date);
    if (!Number.isFinite(reviewTime) || reviewTime <= Date.now()) return json({ error: "review_date_must_be_future" }, 400);
    if (body.skip_dates && (body.skip_dates.length > 366 || body.skip_dates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date)))) return json({ error: "invalid_skip_dates" }, 400);
    const id = `schedule-${body.call.routine.id}`;
    const next = nextOccurrence(new Date(), body.frequency, body.time_sgt);
    const schedule: CareSchedule = { id, status: "active", frequency: body.frequency, time_sgt: body.time_sgt, next_run: next.toISOString(), review_date: body.review_date, skip_dates: body.skip_dates ?? [], phone_ciphertext: await encryptSchedulePhone(body.call.senior.phone_e164, env.CARECALL_DATA_ENCRYPTION_KEY), senior: { id: body.call.senior.id, preferred_name: body.call.senior.preferred_name, language: body.call.senior.language, permitted_call_window: body.call.senior.permitted_call_window }, routine: body.call.routine, organisation: body.call.organisation, created_by: { id: operator.id, name: operator.name, role: operator.role, senior_ids: operator.senior_ids }, created_at: new Date().toISOString() };
    const created = await store.claim(`carecall:schedule:${id}`, schedule, 2 * 365 * 24 * 60 * 60);
    if (!created) return json({ error: "schedule_already_exists" }, 409);
    await store.addToIndex("carecall:schedules:due", next.getTime(), id);
    return json({ schedule: { ...schedule, phone_ciphertext: undefined } }, 201);
  }

  if (request.method === "PATCH") {
    let body: { schedule_id?: string; status?: ScheduleStatus };
    try { body = await request.json() as typeof body; } catch { return json({ error: "invalid_json" }, 400); }
    if (!body.schedule_id || !body.status || !["active", "paused", "cancelled"].includes(body.status)) return json({ error: "invalid_schedule_update" }, 400);
    const schedule = await store.get<CareSchedule>(`carecall:schedule:${body.schedule_id}`);
    if (!schedule) return json({ error: "schedule_not_found" }, 404);
    if (!operatorCanAccessSenior(operator, schedule.senior.id)) return json({ error: "senior_scope_denied" }, 403);
    if (schedule.status === "cancelled" && body.status !== "cancelled") return json({ error: "cancelled_schedule_requires_new_authorization" }, 409);
    schedule.status = body.status;
    if (body.status === "cancelled") schedule.phone_ciphertext = "";
    if (body.status === "active") schedule.next_run = nextOccurrence(new Date(), schedule.frequency, schedule.time_sgt).toISOString();
    await store.set(`carecall:schedule:${schedule.id}`, schedule, 2 * 365 * 24 * 60 * 60);
    if (body.status === "active") await store.addToIndex("carecall:schedules:due", Date.parse(schedule.next_run), schedule.id);
    else await store.removeFromIndex("carecall:schedules:due", schedule.id);
    return json({ schedule: { ...schedule, phone_ciphertext: undefined } });
  }

  return json({ error: "method_not_allowed" }, 405);
}
