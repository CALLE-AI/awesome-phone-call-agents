import { Client, Receiver } from "@upstash/qstash";
import {
  auditCareCall,
  handleCreateCall,
  handleGetCallStatus,
  storeFor,
  type CalleEnv,
} from "./calls";
import { issueTrustedOperatorSession, type OperatorSession } from "./operator-auth";
import { decryptSchedulePhone, encryptSchedulePhone, nextEligibleOccurrence, type CareSchedule } from "./schedules";
import { isTerminalStatus } from "../../src/calle";
import { validateCareCallRequest, type CareCallRequest, type CareCallResult } from "../../src/workflows/carecall";

export type CareCallJobState = "queued" | "starting" | "ongoing" | "completed" | "cancelled" | "needs_review";
export type QueueWakeMessage = { type: "dispatch"; job_id: string } | { type: "status"; job_id: string; version: number };

type StoredCareCallRequest = Omit<CareCallRequest, "senior"> & {
  senior: Omit<CareCallRequest["senior"], "phone_e164">;
};

export interface CareCallJob {
  id: string;
  source: "manual" | "schedule";
  state: CareCallJobState;
  request: StoredCareCallRequest;
  phone_ciphertext: string;
  operator: Pick<OperatorSession, "id" | "name" | "role" | "senior_ids">;
  scheduled_for: string;
  authorization_expires_at?: string;
  schedule_id?: string;
  run_id?: string;
  result?: CareCallResult;
  created_at: string;
  updated_at: string;
  failure_reason?: string;
  status_check_version?: number;
}

export interface QueueRuntimeEnv extends CalleEnv {
  queuePublisher?: (message: QueueWakeMessage, notBefore?: number) => Promise<void>;
  queueVerifier?: (request: Request, body: string) => Promise<boolean>;
}

const JOB_TTL = 365 * 24 * 60 * 60;
const ACTIVE_LEASE_TTL = 2 * 60 * 60;
const ACTIVE_LEASE_KEY = "carecall:queue:active";
const READY_INDEX = "carecall:queue:ready";
const jsonHeaders = { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" };
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: jsonHeaders });

function jobKey(id: string) { return `carecall:job:${id}`; }
function publicWorkerUrl(env: QueueRuntimeEnv): string | null {
  if (!env.CARECALL_PUBLIC_BASE_URL) return null;
  try {
    const url = new URL("/api/carecall/worker", env.CARECALL_PUBLIC_BASE_URL);
    return url.protocol === "https:" ? url.toString() : null;
  } catch { return null; }
}

export function queueConfigured(env: QueueRuntimeEnv): boolean {
  return Boolean(env.CARECALL_DATA_ENCRYPTION_KEY && publicWorkerUrl(env) && (env.queuePublisher || env.QSTASH_TOKEN));
}

export async function publishQueueWake(env: QueueRuntimeEnv, message: QueueWakeMessage, notBefore?: number): Promise<void> {
  if (env.queuePublisher) return env.queuePublisher(message, notBefore);
  const url = publicWorkerUrl(env);
  if (!env.QSTASH_TOKEN || !url) throw new Error("CareCall queue delivery is not configured.");
  const client = new Client({ token: env.QSTASH_TOKEN });
  const deduplicationBytes = message.type === "status" ? new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${message.type}:${message.job_id}:${message.version}`))) : null;
  const deduplicationId = deduplicationBytes ? `carecall-${[...deduplicationBytes].slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")).join("")}` : undefined;
  await client.publishJSON({
    url,
    body: message,
    notBefore,
    retries: 3,
    label: `carecall-${message.type}`,
    deduplicationId,
  });
}

export async function verifyQueueRequest(request: Request, body: string, env: QueueRuntimeEnv): Promise<boolean> {
  if (env.queueVerifier) return env.queueVerifier(request, body);
  const signature = request.headers.get("upstash-signature");
  if (!signature || !env.QSTASH_CURRENT_SIGNING_KEY || !env.QSTASH_NEXT_SIGNING_KEY) return false;
  const receiver = new Receiver({ currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY, nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY });
  return receiver.verify({ signature, body, url: request.url }).catch(() => false);
}

function restoreRequest(job: CareCallJob, phone: string): CareCallRequest {
  return { ...job.request, senior: { ...job.request.senior, phone_e164: phone } };
}

async function createJob(
  request: CareCallRequest,
  operator: CareCallJob["operator"],
  env: QueueRuntimeEnv,
  options: { source: CareCallJob["source"]; scheduledFor?: Date; scheduleId?: string; trustedRecurringAuthorization?: boolean },
): Promise<{ job: CareCallJob; created: boolean }> {
  const store = storeFor(env);
  if (!store || !env.CARECALL_DATA_ENCRYPTION_KEY || !queueConfigured(env)) throw new Error("queue_not_configured");
  const now = new Date();
  const errors = validateCareCallRequest(request, now, {
    enforceCurrentAuthorization: !options.trustedRecurringAuthorization,
    enforceCurrentCallWindow: options.source === "manual",
  });
  if (errors.length) throw new Error(`invalid_request:${errors.join("|")}`);
  const { phone_e164, ...senior } = request.senior;
  const scheduledFor = options.scheduledFor ?? now;
  const id = `job-${request.request_key}`;
  const job: CareCallJob = {
    id,
    source: options.source,
    state: "queued",
    request: { ...request, senior },
    phone_ciphertext: await encryptSchedulePhone(phone_e164, env.CARECALL_DATA_ENCRYPTION_KEY),
    operator,
    scheduled_for: scheduledFor.toISOString(),
    authorization_expires_at: options.source === "manual" ? new Date(now.getTime() + 30 * 60_000).toISOString() : undefined,
    schedule_id: options.scheduleId,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  let created = await store.claim(jobKey(id), job, JOB_TTL);
  if (!created) {
    const existing = await store.get<CareCallJob>(jobKey(id));
    if (existing?.state === "cancelled" && !existing.run_id) {
      await store.set(jobKey(id), job, JOB_TTL);
      created = true;
    } else return { job: existing ?? job, created: false };
  }
  await store.addToIndex(READY_INDEX, scheduledFor.getTime(), id);
  try {
    await publishQueueWake(env, { type: "dispatch", job_id: id }, Math.max(Math.floor(scheduledFor.getTime() / 1000), Math.floor(Date.now() / 1000)));
  } catch (error) {
    job.state = "needs_review";
    job.phone_ciphertext = "";
    job.failure_reason = "queue_delivery_failed";
    job.updated_at = new Date().toISOString();
    await store.set(jobKey(id), job, JOB_TTL);
    await store.removeFromIndex(READY_INDEX, id);
    throw error;
  }
  await auditCareCall(store, operator.id, "call_queued", { job_id: id, request_key: request.request_key, source: options.source, scheduled_for: job.scheduled_for });
  return { job, created: true };
}

export async function enqueueScheduledOccurrence(schedule: CareSchedule, env: QueueRuntimeEnv): Promise<CareCallJob> {
  if (!env.CARECALL_DATA_ENCRYPTION_KEY) throw new Error("queue_not_configured");
  const phone = await decryptSchedulePhone(schedule.phone_ciphertext, env.CARECALL_DATA_ENCRYPTION_KEY);
  const request: CareCallRequest = {
    workflow: "carecall",
    request_key: `${schedule.id}:${schedule.next_run}`,
    organisation: schedule.organisation,
    senior: { ...schedule.senior, phone_e164: phone, authority_confirmed: true },
    routine: schedule.routine,
    authorization: { exactly_one_call: true, authorized_at: schedule.created_at },
  };
  return (await createJob(request, schedule.created_by, env, {
    source: "schedule",
    scheduledFor: new Date(schedule.next_run),
    scheduleId: schedule.id,
    trustedRecurringAuthorization: true,
  })).job;
}

export async function handleEnqueueCareCall(request: Request, env: QueueRuntimeEnv): Promise<Response> {
  const { authenticateOperator, operatorCanAccessSenior } = await import("./operator-auth");
  const operator = await authenticateOperator(request, env);
  if (!operator) return json({ error: "invalid_operator_session" }, 401);
  const rawBody = await request.text();
  if (rawBody.length > 64 * 1024) return json({ error: "request_too_large" }, 413);
  let payload: CareCallRequest;
  try { payload = JSON.parse(rawBody) as CareCallRequest; } catch { return json({ error: "invalid_json" }, 400); }
  if (!operatorCanAccessSenior(operator, payload?.senior?.id)) return json({ error: "senior_scope_denied" }, 403);
  try {
    const { job, created } = await createJob(payload, operator, env, { source: "manual" });
    return json({ job_id: job.id, status: job.state, deduplicated: !created }, created ? 202 : 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "queue_failed";
    if (message.startsWith("invalid_request:")) return json({ error: "invalid_request", details: message.slice(16).split("|") }, 400);
    return json({ error: "queue_not_configured", message: "The durable call queue could not accept this call. No call was placed." }, 503);
  }
}

async function markNeedsReview(job: CareCallJob, env: QueueRuntimeEnv, reason: string): Promise<void> {
  const store = storeFor(env);
  if (!store) return;
  job.state = "needs_review";
  job.phone_ciphertext = "";
  job.failure_reason = reason;
  job.updated_at = new Date().toISOString();
  await store.set(jobKey(job.id), job, JOB_TTL);
  await store.removeFromIndex(READY_INDEX, job.id);
  await store.releaseClaim(ACTIVE_LEASE_KEY, { job_id: job.id });
  if (job.schedule_id) {
    const schedule = await store.get<CareSchedule>(`carecall:schedule:${job.schedule_id}`);
    if (schedule?.current_job_id === job.id) {
      schedule.status = "needs_review";
      await store.set(`carecall:schedule:${schedule.id}`, schedule, 2 * JOB_TTL);
      await store.removeFromIndex("carecall:schedules:due", schedule.id);
    }
  }
  await auditCareCall(store, job.operator.id, "queued_call_needs_review", { job_id: job.id, reason });
}

async function wakeNextReady(env: QueueRuntimeEnv): Promise<void> {
  const store = storeFor(env);
  if (!store) return;
  const ids = await store.readDueIndex(READY_INDEX, Date.now(), 20);
  for (const id of ids) {
    const job = await store.get<CareCallJob>(jobKey(id));
    if (job?.state === "queued") {
      await publishQueueWake(env, { type: "dispatch", job_id: id });
      return;
    }
    await store.removeFromIndex(READY_INDEX, id);
  }
}

async function scheduleStatusCheck(job: CareCallJob, env: QueueRuntimeEnv, delaySeconds = 10): Promise<void> {
  const store = storeFor(env);
  if (!store) throw new Error("queue_not_configured");
  job.status_check_version = (job.status_check_version ?? 0) + 1;
  job.updated_at = new Date().toISOString();
  await store.set(jobKey(job.id), job, JOB_TTL);
  await publishQueueWake(env, { type: "status", job_id: job.id, version: job.status_check_version }, Math.floor(Date.now() / 1000) + delaySeconds);
}

async function advanceRecurringSchedule(job: CareCallJob, env: QueueRuntimeEnv): Promise<void> {
  if (!job.schedule_id) return;
  const store = storeFor(env);
  if (!store) return;
  const schedule = await store.get<CareSchedule>(`carecall:schedule:${job.schedule_id}`);
  if (schedule?.status !== "active" || schedule.current_job_id !== job.id || Date.parse(schedule.review_date) <= Date.now()) return;
  const next = nextEligibleOccurrence(new Date(Math.max(Date.now(), Date.parse(job.scheduled_for))), schedule.frequency, schedule.time_sgt, schedule.skip_dates);
  schedule.next_run = next.toISOString();
  schedule.current_job_id = undefined;
  await store.set(`carecall:schedule:${schedule.id}`, schedule, 2 * JOB_TTL);
  await store.addToIndex("carecall:schedules:due", next.getTime(), schedule.id);
  try {
    const nextJob = await enqueueScheduledOccurrence(schedule, env);
    schedule.current_job_id = nextJob.id;
    await store.set(`carecall:schedule:${schedule.id}`, schedule, 2 * JOB_TTL);
  } catch {
    schedule.status = "needs_review";
    await store.set(`carecall:schedule:${schedule.id}`, schedule, 2 * JOB_TTL);
    await store.removeFromIndex("carecall:schedules:due", schedule.id);
  }
}

async function dispatchJob(job: CareCallJob, env: QueueRuntimeEnv): Promise<void> {
  const store = storeFor(env);
  if (!store || !env.CARECALL_DATA_ENCRYPTION_KEY) throw new Error("queue_not_configured");
  if (job.state === "starting") {
    const claim = await store.get<{ state?: string; run_id?: string }>(`carecall:request:${job.request.request_key}`);
    if (claim?.state === "started" && claim.run_id) {
      job.state = "ongoing";
      job.run_id = claim.run_id;
      job.phone_ciphertext = "";
      job.updated_at = new Date().toISOString();
      await store.set(jobKey(job.id), job, JOB_TTL);
      await scheduleStatusCheck(job, env, 0);
    } else {
      await markNeedsReview(job, env, "call_creation_uncertain");
      await wakeNextReady(env);
    }
    return;
  }
  if (job.state === "ongoing") {
    await scheduleStatusCheck(job, env);
    return;
  }
  if (job.state !== "queued" || Date.parse(job.scheduled_for) > Date.now()) return;
  const lease = { job_id: job.id };
  if (!await store.claim(ACTIVE_LEASE_KEY, lease, ACTIVE_LEASE_TTL)) return;
  job.state = "starting";
  job.updated_at = new Date().toISOString();
  await store.set(jobKey(job.id), job, JOB_TTL);
  await store.removeFromIndex(READY_INDEX, job.id);

  if (job.source === "manual" && (!job.authorization_expires_at || Date.parse(job.authorization_expires_at) <= Date.now())) {
    await markNeedsReview(job, env, "manual_authorization_expired");
    await wakeNextReady(env);
    return;
  }

  if (job.schedule_id) {
    const schedule = await store.get<CareSchedule>(`carecall:schedule:${job.schedule_id}`);
    if (!schedule || schedule.status !== "active" || schedule.current_job_id !== job.id || Date.parse(schedule.review_date) <= Date.now()) {
      await markNeedsReview(job, env, "schedule_no_longer_authorized");
      await wakeNextReady(env);
      return;
    }
  }

  const token = await issueTrustedOperatorSession(job.operator, env);
  if (!token) {
    await markNeedsReview(job, env, "operator_unavailable");
    await wakeNextReady(env);
    return;
  }
  let phone: string;
  try { phone = await decryptSchedulePhone(job.phone_ciphertext, env.CARECALL_DATA_ENCRYPTION_KEY); }
  catch { await markNeedsReview(job, env, "phone_decryption_failed"); await wakeNextReady(env); return; }
  const callRequest = new Request("https://internal.invalid/api/calls", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(restoreRequest(job, phone)),
  });
  const response = await handleCreateCall(callRequest, env, { trustedQueuedAuthorization: true });
  const body = await response.json() as { call_id?: string; error?: string };
  if (!response.ok || !body.call_id) {
    await markNeedsReview(job, env, body.error ?? "call_start_failed");
    await wakeNextReady(env);
    return;
  }
  job.state = "ongoing";
  job.run_id = body.call_id;
  job.phone_ciphertext = "";
  job.updated_at = new Date().toISOString();
  await store.set(jobKey(job.id), job, JOB_TTL);
  await auditCareCall(store, job.operator.id, "queued_call_started", { job_id: job.id, run_id: job.run_id, source: job.source });
  await scheduleStatusCheck(job, env);
}

async function monitorJob(job: CareCallJob, version: number, env: QueueRuntimeEnv): Promise<void> {
  const store = storeFor(env);
  if (!store) throw new Error("queue_not_configured");
  if (job.status_check_version !== version) return;
  if (job.state === "completed") {
    await advanceRecurringSchedule(job, env);
    await store.releaseClaim(ACTIVE_LEASE_KEY, { job_id: job.id });
    await wakeNextReady(env);
    return;
  }
  if (job.state === "cancelled" || job.state === "needs_review") {
    await store.releaseClaim(ACTIVE_LEASE_KEY, { job_id: job.id });
    await wakeNextReady(env);
    return;
  }
  if (job.state !== "ongoing" || !job.run_id) return;
  const token = await issueTrustedOperatorSession(job.operator, env);
  if (!token) { await markNeedsReview(job, env, "operator_unavailable"); await wakeNextReady(env); return; }
  const response = await handleGetCallStatus(new Request("https://internal.invalid/api/calls/status", { headers: { authorization: `Bearer ${token}` } }), job.run_id, env);
  const body = await response.json() as { status?: string; carecall_result?: CareCallResult; error?: string };
  if (!response.ok) throw new Error(body.error ?? "status_check_failed");
  if (!body.status || !isTerminalStatus(body.status)) {
    if (!await store.refreshClaim(ACTIVE_LEASE_KEY, { job_id: job.id }, ACTIVE_LEASE_TTL)) {
      await markNeedsReview(job, env, "active_lease_lost");
      return;
    }
    await scheduleStatusCheck(job, env);
    return;
  }
  job.state = "completed";
  job.result = body.carecall_result;
  job.updated_at = new Date().toISOString();
  await store.set(jobKey(job.id), job, JOB_TTL);
  await store.releaseClaim(ACTIVE_LEASE_KEY, { job_id: job.id });
  await auditCareCall(store, job.operator.id, "queued_call_completed", { job_id: job.id, run_id: job.run_id, source: job.source });

  await advanceRecurringSchedule(job, env);
  await wakeNextReady(env);
}

export async function processQueueMessage(message: QueueWakeMessage, env: QueueRuntimeEnv): Promise<void> {
  const store = storeFor(env);
  if (!store) throw new Error("queue_not_configured");
  const job = await store.get<CareCallJob>(jobKey(message.job_id));
  if (!job) return;
  if (message.type === "dispatch") await dispatchJob(job, env);
  else await monitorJob(job, message.version, env);
}

export async function handleQueueWorker(request: Request, env: QueueRuntimeEnv): Promise<Response> {
  const body = await request.text();
  if (!await verifyQueueRequest(request, body, env)) return json({ error: "invalid_queue_signature" }, 401);
  let message: QueueWakeMessage;
  try { message = JSON.parse(body) as QueueWakeMessage; } catch { return json({ error: "invalid_json" }, 400); }
  if (!message.job_id || !["dispatch", "status"].includes(message.type) || (message.type === "status" && !Number.isInteger(message.version))) return json({ error: "invalid_queue_message" }, 400);
  try { await processQueueMessage(message, env); return json({ accepted: true }); }
  catch { return json({ error: "queue_processing_failed" }, 500); }
}

export async function handleGetCareCallJob(request: Request, id: string, env: QueueRuntimeEnv): Promise<Response> {
  const { authenticateOperator, operatorCanAccessSenior } = await import("./operator-auth");
  const operator = await authenticateOperator(request, env);
  if (!operator) return json({ error: "invalid_operator_session" }, 401);
  const store = storeFor(env);
  if (!store) return json({ error: "queue_not_configured" }, 503);
  const job = await store.get<CareCallJob>(jobKey(id));
  if (!job) return json({ error: "job_not_found" }, 404);
  if (!operatorCanAccessSenior(operator, job.request.senior.id)) return json({ error: "senior_scope_denied" }, 403);
  if (job.state === "queued" && job.source === "manual" && (!job.authorization_expires_at || Date.parse(job.authorization_expires_at) <= Date.now())) {
    await markNeedsReview(job, env, "manual_authorization_expired");
  }
  const queued = await store.readDueIndex(READY_INDEX, Number.MAX_SAFE_INTEGER, 100);
  return json({ job_id: job.id, status: job.state, run_id: job.run_id, result: job.result, failure_reason: job.failure_reason, queue_position: job.state === "queued" ? Math.max(1, queued.indexOf(job.id) + 1) : undefined });
}

export async function handleCancelCareCallJob(request: Request, id: string, env: QueueRuntimeEnv): Promise<Response> {
  const { authenticateOperator, operatorCanAccessSenior } = await import("./operator-auth");
  const operator = await authenticateOperator(request, env);
  if (!operator) return json({ error: "invalid_operator_session" }, 401);
  const store = storeFor(env);
  if (!store) return json({ error: "queue_not_configured" }, 503);
  const job = await store.get<CareCallJob>(jobKey(id));
  if (!job) return json({ error: "job_not_found" }, 404);
  if (!operatorCanAccessSenior(operator, job.request.senior.id)) return json({ error: "senior_scope_denied" }, 403);
  if (job.state !== "queued") return json({ error: "job_already_started", message: "An ongoing provider call cannot be recalled." }, 409);
  job.state = "cancelled";
  job.phone_ciphertext = "";
  job.updated_at = new Date().toISOString();
  await store.set(jobKey(id), job, JOB_TTL);
  await store.removeFromIndex(READY_INDEX, id);
  await auditCareCall(store, operator.id, "queued_call_cancelled", { job_id: id, source: job.source });
  return json({ job_id: id, status: job.state });
}

export async function cancelQueuedJobForSchedule(id: string | undefined, env: QueueRuntimeEnv, reason: string): Promise<void> {
  if (!id) return;
  const store = storeFor(env);
  if (!store) return;
  const job = await store.get<CareCallJob>(jobKey(id));
  if (!job || job.state !== "queued") return;
  job.state = "cancelled";
  job.phone_ciphertext = "";
  job.failure_reason = reason;
  job.updated_at = new Date().toISOString();
  await store.set(jobKey(id), job, JOB_TTL);
  await store.removeFromIndex(READY_INDEX, id);
}

export async function reconcileDueSchedules(env: QueueRuntimeEnv, now = new Date()): Promise<Array<{ schedule_id: string; state: string }>> {
  const store = storeFor(env);
  if (!store || !queueConfigured(env)) throw new Error("queue_not_configured");
  const ids = await store.readDueIndex("carecall:schedules:due", now.getTime(), 100);
  const results: Array<{ schedule_id: string; state: string }> = [];
  for (const id of ids) {
    const schedule = await store.get<CareSchedule>(`carecall:schedule:${id}`);
    if (!schedule || schedule.status !== "active") {
      await store.removeFromIndex("carecall:schedules:due", id);
      continue;
    }
    if (Date.parse(schedule.review_date) <= now.getTime()) {
      await cancelQueuedJobForSchedule(schedule.current_job_id, env, "review_expired");
      schedule.status = "needs_review";
      await store.set(`carecall:schedule:${id}`, schedule, 2 * JOB_TTL);
      await store.removeFromIndex("carecall:schedules:due", id);
      results.push({ schedule_id: id, state: "review_expired" });
      continue;
    }
    const job = schedule.current_job_id ? await store.get<CareCallJob>(jobKey(schedule.current_job_id)) : null;
    if (!job) {
      schedule.status = "needs_review";
      await store.set(`carecall:schedule:${id}`, schedule, 2 * JOB_TTL);
      await store.removeFromIndex("carecall:schedules:due", id);
      results.push({ schedule_id: id, state: "missing_queue_job" });
      continue;
    }
    if (job.state === "ongoing") {
      await scheduleStatusCheck(job, env, 0);
      results.push({ schedule_id: id, state: "status_requeued" });
      continue;
    }
    if (job.state === "completed") {
      await advanceRecurringSchedule(job, env);
      results.push({ schedule_id: id, state: "next_occurrence_repaired" });
      continue;
    }
    if (job.state === "queued" && now.getTime() - Date.parse(job.scheduled_for) <= 15 * 60_000) {
      await publishQueueWake(env, { type: "dispatch", job_id: job.id });
      results.push({ schedule_id: id, state: "dispatch_requeued" });
      continue;
    }
    await markNeedsReview(job, env, "scheduled_occurrence_missed");
    results.push({ schedule_id: id, state: "needs_review" });
  }
  return results;
}
