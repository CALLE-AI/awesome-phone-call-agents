// Server-side integration layer for CALL-E.
//
// Credentials live only here, supplied through Vercel environment variables.
// They must never reach browser code, and neither must the confirm_token: it
// authorizes one real phone call, so it is created, spent, and discarded inside
// a single request.
//
// CALL-E is MCP. plan_call issues a plan_id and a confirm_token, run_call
// requires both, and get_call_run polls the result. The operator's explicit
// authorization happens in the browser before this endpoint is reached; the
// server then performs plan, confirm, and run as one atomic step.
//
// Every entry point here requires a signed operator session and a senior the
// session is scoped to. There is no unauthenticated path to a phone call, and
// no path that is not CareCall.
//
// These handlers take and return web-standard Request and Response, so they run
// unchanged on any runtime with fetch and are not tied to Vercel.
//
// See docs/agent-gallery/calle-api-observations.md.

import { CalleError, createCalleClient, isTerminalStatus } from "../../src/calle";
import type { CalleActivity, CalleRun } from "../../src/calle";
import {
  buildCareCallResult,
  buildCareCallGoal,
  validateCareCallRequest,
  type CareCallRequest,
} from "../../src/workflows/carecall";
import type { CareCallResult } from "../../src/workflows/carecall";
import { createRedisRestStore, type DurableStore } from "./durable-store";
import { authenticateOperator, operatorCanAccessSenior, type OperatorAuthEnv } from "./operator-auth";

export interface CalleEnv extends OperatorAuthEnv {
  CALLE_ACCESS_TOKEN?: string;
  CALLE_SERVER_URL?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  CARECALL_MAX_CALLS_PER_DAY?: string;
  CARECALL_DATA_ENCRYPTION_KEY?: string;
  CRON_SECRET?: string;
  CARECALL_PUBLIC_BASE_URL?: string;
  QSTASH_URL?: string;
  QSTASH_TOKEN?: string;
  QSTASH_CURRENT_SIGNING_KEY?: string;
  QSTASH_NEXT_SIGNING_KEY?: string;
  /** Tests inject a deterministic store; production uses the REST configuration above. */
  durableStore?: DurableStore;
}

const REQUEST_LIMIT = 64 * 1024;

const jsonHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: jsonHeaders });
}

interface CareCallClaim { state: "pending" | "started" | "failed"; operator_id: string; senior_id: string; run_id?: string; updated_at: string }
export interface CareCallTiming {
  started_at?: string;
  ended_at?: string;
  duration_seconds?: number;
}

interface CareCallRunRecord {
  run_id: string;
  request_key: string;
  operator_id: string;
  senior_id: string;
  senior_name: string;
  routine_id: string;
  routine_title: string;
  routine_kind: CareCallRequest["routine"]["kind"];
  caregiver_name: string;
  created_at: string;
  result?: CareCallResult;
  timing?: CareCallTiming;
}

function careCallTiming(run: CalleRun): CareCallTiming | undefined {
  const calling = run.result?.extracted?.calling;
  if (!calling || typeof calling !== "object" || Array.isArray(calling)) return undefined;
  const value = calling as Record<string, unknown>;
  const startedAt = typeof value.started_at === "string" && Number.isFinite(Date.parse(value.started_at)) ? value.started_at : undefined;
  const endedAt = typeof value.ended_at === "string" && Number.isFinite(Date.parse(value.ended_at)) ? value.ended_at : undefined;
  const rawDuration = typeof value.duration_seconds === "number" ? value.duration_seconds : Number(value.duration_seconds);
  const durationSeconds = Number.isFinite(rawDuration) && rawDuration >= 0 ? Math.round(rawDuration) : undefined;
  return startedAt || endedAt || durationSeconds !== undefined
    ? { started_at: startedAt, ended_at: endedAt, duration_seconds: durationSeconds }
    : undefined;
}

export function storeFor(env: CalleEnv): DurableStore | null {
  if (env.durableStore) return env.durableStore;
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return null;
  return createRedisRestStore(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);
}

export async function auditCareCall(store: DurableStore, operatorId: string, action: string, details: Record<string, unknown>) {
  const timestamp = Date.now();
  const id = crypto.randomUUID();
  const record = { id, operator_id: operatorId, action, details, created_at: new Date(timestamp).toISOString() };
  await store.set(`carecall:audit:${id}`, record, 365 * 24 * 60 * 60);
  await store.addToIndex("carecall:audit:index", timestamp, id);
}

function operatorFailure(): Response {
  return json({ error: "invalid_operator_session", message: "A valid CareCall operator session is required." }, 401);
}

function clientFor(env: CalleEnv) {
  if (!env.CALLE_ACCESS_TOKEN || !env.CALLE_SERVER_URL) return null;
  return createCalleClient({
    accessToken: env.CALLE_ACCESS_TOKEN,
    serverUrl: env.CALLE_SERVER_URL,
  });
}

function calleFailure(error: unknown): Response {
  if (error instanceof CalleError) {
    const status = error.code === "timeout" ? 504 : 502;
    return json({ error: error.code, message: error.message }, status);
  }
  return json({ error: "unexpected", message: "The call could not be started." }, 500);
}

export async function handleCreateCall(request: Request, env: CalleEnv, options: { trustedQueuedAuthorization?: boolean } = {}): Promise<Response> {
  const operator = await authenticateOperator(request, env);
  if (!operator) return operatorFailure();

  const body = await request.text();
  if (body.length > REQUEST_LIMIT) return json({ error: "request_too_large" }, 413);

  let payload: CareCallRequest;
  try {
    payload = JSON.parse(body) as CareCallRequest;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!payload?.request_key || typeof payload.request_key !== "string") {
    return json({ error: "missing_request_key" }, 400);
  }

  // The browser already validated, but a server must never trust that.
  const errors = validateCareCallRequest(payload, new Date(), {
    enforceCurrentAuthorization: !options.trustedQueuedAuthorization,
  });
  if (errors.length > 0) return json({ error: "invalid_request", details: errors }, 400);

  if (!operatorCanAccessSenior(operator, payload.senior.id)) return json({ error: "senior_scope_denied" }, 403);
  const store = storeFor(env);
  if (!store) return json({ error: "durable_storage_not_configured", message: "CareCall requires durable storage before live calls are enabled." }, 503);

  const claimKey = `carecall:request:${payload.request_key}`;
  const pending: CareCallClaim = { state: "pending", operator_id: operator.id, senior_id: payload.senior.id, updated_at: new Date().toISOString() };
  const acquired = await store.claim(claimKey, pending, 7 * 24 * 60 * 60);
  if (!acquired) {
    const existing = await store.get<CareCallClaim>(claimKey);
    if (existing?.state === "started" && existing.run_id) return json({ call_id: existing.run_id, deduplicated: true });
    return json({ error: "request_already_claimed", state: existing?.state ?? "unknown", message: "This request is already claimed. Check its audit record before retrying." }, 409);
  }
  const day = new Date().toISOString().slice(0, 10);
  const count = await store.increment(`carecall:limit:${operator.id}:${day}`, 48 * 60 * 60);
  const maximum = Math.max(1, Number(env.CARECALL_MAX_CALLS_PER_DAY ?? 20));
  if (count > maximum) {
    await store.set(claimKey, { ...pending, state: "failed", updated_at: new Date().toISOString() } satisfies CareCallClaim, 7 * 24 * 60 * 60);
    await auditCareCall(store, operator.id, "call_rate_limited", { request_key: payload.request_key, senior_id: payload.senior.id });
    return json({ error: "daily_call_limit_reached", message: "The operator's daily CareCall limit has been reached." }, 429);
  }
  const snapshotTtl = 365 * 24 * 60 * 60;
  await store.set(`carecall:senior:${payload.senior.id}`, { id: payload.senior.id, preferred_name: payload.senior.preferred_name, phone_masked: `•••${payload.senior.phone_e164.slice(-3)}`, language: payload.senior.language, permitted_call_window: payload.senior.permitted_call_window }, snapshotTtl);
  await store.set(`carecall:consent:${payload.senior.id}`, { senior_id: payload.senior.id, authority_confirmed: true, confirmed_by: operator.id, confirmed_at: payload.authorization.authorized_at }, snapshotTtl);
  await store.set(`carecall:routine:${payload.routine.id}`, { ...payload.routine, senior_id: payload.senior.id }, snapshotTtl);
  await auditCareCall(store, operator.id, "call_claimed", { request_key: payload.request_key, senior_id: payload.senior.id, routine_id: payload.routine.id });

  const failClaim = async () => {
    await store.set(claimKey, { state: "failed", operator_id: operator.id, senior_id: payload.senior.id, updated_at: new Date().toISOString() } satisfies CareCallClaim, 7 * 24 * 60 * 60);
  };

  const client = clientFor(env);
  if (!client) {
    await failClaim();
    return json(
      {
        error: "not_configured",
        message: "This deployment has no CALL-E credentials, so it cannot place calls.",
      },
      503,
    );
  }

  try {
    const plan = await client.planCall({
      to_phones: [payload.senior.phone_e164],
      goal: buildCareCallGoal(payload),
      language: "English",
    });

    if (!plan.ready_to_run || !plan.confirm_token) {
      await failClaim();
      return json(
        { error: "plan_incomplete", message: "CALL-E needs more detail before this call can run." },
        409,
      );
    }

    const run = await client.runCall({ plan_id: plan.plan_id, confirm_token: plan.confirm_token });
    const record: CareCallRunRecord = { run_id: run.run_id, request_key: payload.request_key, operator_id: operator.id, senior_id: payload.senior.id, senior_name: payload.senior.preferred_name, routine_id: payload.routine.id, routine_title: payload.routine.title, routine_kind: payload.routine.kind, caregiver_name: payload.routine.caregiver_name, created_at: new Date().toISOString() };
    await store.set(`carecall:run:${run.run_id}`, record, 365 * 24 * 60 * 60);
    await store.set(claimKey, { state: "started", operator_id: operator.id, senior_id: payload.senior.id, run_id: run.run_id, updated_at: new Date().toISOString() } satisfies CareCallClaim, 7 * 24 * 60 * 60);
    await auditCareCall(store, operator.id, "call_started", { run_id: run.run_id, request_key: payload.request_key, senior_id: payload.senior.id });
    return json({ call_id: run.run_id, status: run.status });
  } catch (error) {
    await failClaim();
    await auditCareCall(store, operator.id, "call_start_failed", { request_key: payload.request_key, senior_id: payload.senior.id });
    return calleFailure(error);
  }
}

export async function handleGetCallStatus(
  request: Request,
  runId: string,
  env: CalleEnv,
): Promise<Response> {
  const operator = await authenticateOperator(request, env);
  if (!operator) return operatorFailure();
  if (!runId) return json({ error: "missing_run_id" }, 400);

  const store = storeFor(env);
  if (!store) return json({ error: "durable_storage_not_configured" }, 503);
  const careRecord = await store.get<CareCallRunRecord>(`carecall:run:${runId}`);
  if (!careRecord) return json({ error: "call_record_not_found" }, 404);
  if (!operatorCanAccessSenior(operator, careRecord.senior_id)) return json({ error: "senior_scope_denied" }, 403);
  if (careRecord.result) return json({ status: careRecord.result.provider_status, activity: [], carecall_result: careRecord.result, call_timing: careRecord.timing });

  const client = clientFor(env);
  if (!client) return json({ error: "not_configured" }, 503);

  let run: CalleRun;
  try {
    run = await client.getCallRun({ run_id: runId });
  } catch (error) {
    return calleFailure(error);
  }

  const activity = (run.activity ?? []).map((entry: CalleActivity) => ({
    ts: entry.ts,
    level: entry.level,
    message: entry.message,
  }));
  const timing = careCallTiming(run);

  if (!isTerminalStatus(run.status)) {
    return json({ status: run.status, activity, call_timing: timing });
  }

  const resultRequest: CareCallRequest = {
    workflow: "carecall",
    request_key: careRecord.request_key,
    organisation: { name: "CareCall SG", timezone: "Asia/Singapore" },
    senior: { id: careRecord.senior_id, preferred_name: careRecord.senior_name, phone_e164: "+6500000000", language: "English", authority_confirmed: true, permitted_call_window: "12:00 AM–11:59 PM" },
    routine: { id: careRecord.routine_id, kind: careRecord.routine_kind, title: careRecord.routine_title, caregiver_instruction: "Persisted call context", caregiver_name: careRecord.caregiver_name, trust_phrase: "Persisted call context" },
    authorization: { exactly_one_call: true, authorized_at: careRecord.created_at },
  };
  const result = buildCareCallResult({ request: resultRequest, status: run.status, calle: run.result ?? null, runId });
  careRecord.result = result;
  careRecord.timing = timing;
  await store.set(`carecall:run:${runId}`, careRecord, 365 * 24 * 60 * 60);
  if (result.follow_up_required) {
    const caseRecord = { id: `live-${result.call_id}`, seniorId: careRecord.senior_id, routineId: careRecord.routine_id, priority: result.urgency === "contact-now" ? "contact-now" : result.urgency === "follow-up-today" ? "today" : "review", priorityLabel: result.urgency === "contact-now" ? "Contact now" : result.urgency === "follow-up-today" ? "Follow up today" : "Review when available", title: result.outcome_label, createdAt: new Date().toISOString(), context: result.evidence ?? "No reliable conversational evidence was returned.", nextAction: result.next_action, acknowledged: false };
    await store.set(`carecall:case:${caseRecord.id}`, caseRecord, 365 * 24 * 60 * 60);
    await store.addToIndex("carecall:cases:index", Date.now(), caseRecord.id);
  }
  await auditCareCall(store, operator.id, "call_completed", { run_id: runId, senior_id: careRecord.senior_id, outcome: result.outcome, urgency: result.urgency });
  return json({ status: run.status, activity, carecall_result: result, call_timing: timing });
}

/** Read credentials from the process environment without exposing their values. */
export function envFromProcess(): CalleEnv {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  return {
    CALLE_ACCESS_TOKEN: env.CALLE_ACCESS_TOKEN,
    CALLE_SERVER_URL: env.CALLE_SERVER_URL,
    CARECALL_OPERATORS_JSON: env.CARECALL_OPERATORS_JSON,
    CARECALL_SESSION_SECRET: env.CARECALL_SESSION_SECRET,
    UPSTASH_REDIS_REST_URL: env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: env.UPSTASH_REDIS_REST_TOKEN,
    CARECALL_MAX_CALLS_PER_DAY: env.CARECALL_MAX_CALLS_PER_DAY,
    CARECALL_DATA_ENCRYPTION_KEY: env.CARECALL_DATA_ENCRYPTION_KEY,
    CRON_SECRET: env.CRON_SECRET,
    CARECALL_PUBLIC_BASE_URL: env.CARECALL_PUBLIC_BASE_URL,
    QSTASH_URL: env.QSTASH_URL,
    QSTASH_TOKEN: env.QSTASH_TOKEN,
    QSTASH_CURRENT_SIGNING_KEY: env.QSTASH_CURRENT_SIGNING_KEY,
    QSTASH_NEXT_SIGNING_KEY: env.QSTASH_NEXT_SIGNING_KEY,
  };
}
