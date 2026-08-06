import assert from "node:assert/strict";
import test from "node:test";
import { handleCancelCareCallJob, handleEnqueueCareCall, handleQueueWorker, processQueueMessage, type CareCallJob, type QueueWakeMessage } from "../api/_lib/call-queue";
import { MemoryDurableStore } from "../api/_lib/durable-store";
import { issueOperatorSession } from "../api/_lib/operator-auth";
import type { CareCallRequest } from "../src/workflows/carecall";
import { FAKE_SERVER_URL, FAKE_TOKEN, createFakeCalle } from "./fake-calle-server";

const ACCESS_CODE = "test-operator-code";

function request(key: string): CareCallRequest {
  return {
    workflow: "carecall",
    request_key: key,
    organisation: { name: "Queenstown Care Team", timezone: "Asia/Singapore" },
    senior: { id: "mdm-lim", preferred_name: "Mdm Lim", phone_e164: "+6580000000", language: "English", authority_confirmed: true, permitted_call_window: "12:00 AM–11:59 PM" },
    routine: { id: `routine-${key}`, kind: "meal", title: "Lunch check-in", caregiver_instruction: "Repeat the approved lunch reminder.", caregiver_name: "Joanne Lim", trust_phrase: "Joanne asked me to call." },
    authorization: { exactly_one_call: true, authorized_at: new Date().toISOString() },
  };
}

function environment() {
  const messages: QueueWakeMessage[] = [];
  const durableStore = new MemoryDurableStore();
  return {
    messages,
    env: {
      CALLE_ACCESS_TOKEN: FAKE_TOKEN,
      CALLE_SERVER_URL: FAKE_SERVER_URL,
      CARECALL_SESSION_SECRET: "test-session-secret-that-is-at-least-32-characters",
      CARECALL_OPERATORS_JSON: JSON.stringify([{ id: "mei-chen", name: "Mei Chen", role: "coordinator", access_code_sha256: "1427b7e058bb398ae674d86981bc0e4f796661abc0ccbba06c3e9ec611f9f07f", senior_ids: ["mdm-lim"] }]),
      CARECALL_DATA_ENCRYPTION_KEY: "schedule-encryption-secret-with-32-characters",
      CARECALL_PUBLIC_BASE_URL: "https://example.test",
      durableStore,
      queuePublisher: async (message: QueueWakeMessage) => { messages.push(message); },
      queueVerifier: async () => true,
    },
  };
}

async function authorizedRequest(body: CareCallRequest, env: ReturnType<typeof environment>["env"]): Promise<Request> {
  const token = await issueOperatorSession("mei-chen", ACCESS_CODE, env);
  assert.ok(token);
  return new Request("https://example.test/api/carecall/jobs", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
}

async function withFakeCalle<T>(run: () => Promise<T>, fake = createFakeCalle({ statusSequence: ["COMPLETED"], terminalResult: { summary: "CARECALL_OUTCOME=self_reported_ate", call_id: "call-1" } })): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  try { return await run(); } finally { globalThis.fetch = original; }
}

test("manual CareCalls enter the durable queue without exposing the phone number", async () => {
  const { env, messages } = environment();
  const response = await handleEnqueueCareCall(await authorizedRequest(request("manual-queue"), env), env);
  assert.equal(response.status, 202);
  assert.deepEqual(messages, [{ type: "dispatch", job_id: "job-manual-queue" }]);
  const job = await env.durableStore.get<CareCallJob>("carecall:job:job-manual-queue");
  assert.equal(job?.state, "queued");
  assert.doesNotMatch(JSON.stringify(job), /6580000000/);
});

test("only one queued CareCall starts while another call owns the active lease", async () => {
  const { env } = environment();
  await handleEnqueueCareCall(await authorizedRequest(request("first"), env), env);
  await handleEnqueueCareCall(await authorizedRequest(request("second"), env), env);
  const fake = createFakeCalle({ statusSequence: ["COMPLETED"], terminalResult: { summary: "CARECALL_OUTCOME=self_reported_ate", call_id: "call-1" } });

  await withFakeCalle(() => processQueueMessage({ type: "dispatch", job_id: "job-first" }, env), fake);
  await withFakeCalle(() => processQueueMessage({ type: "dispatch", job_id: "job-second" }, env), fake);
  const firstAfterDispatch = await env.durableStore.get<CareCallJob>("carecall:job:job-first");
  if (firstAfterDispatch?.state !== "ongoing") throw new Error(JSON.stringify(firstAfterDispatch));
  assert.equal((await env.durableStore.get<CareCallJob>("carecall:job:job-second"))?.state, "queued");
  assert.equal(fake.runCallAttempts, 1);

  await withFakeCalle(() => processQueueMessage({ type: "status", job_id: "job-first", version: firstAfterDispatch.status_check_version ?? 0 }, env), fake);
  assert.equal((await env.durableStore.get<CareCallJob>("carecall:job:job-first"))?.state, "completed");
  const secondFake = createFakeCalle();
  await withFakeCalle(() => processQueueMessage({ type: "dispatch", job_id: "job-second" }, env), secondFake);
  assert.equal((await env.durableStore.get<CareCallJob>("carecall:job:job-second"))?.state, "ongoing");
  assert.equal(secondFake.runCallAttempts, 1);
});

test("a queued manual call can be cancelled before it starts", async () => {
  const { env } = environment();
  await handleEnqueueCareCall(await authorizedRequest(request("cancel-me"), env), env);
  const token = await issueOperatorSession("mei-chen", ACCESS_CODE, env);
  assert.ok(token);
  const response = await handleCancelCareCallJob(new Request("https://example.test/api/carecall/jobs/job-cancel-me", { method: "DELETE", headers: { authorization: `Bearer ${token}` } }), "job-cancel-me", env);
  assert.equal(response.status, 200);
  const job = await env.durableStore.get<CareCallJob>("carecall:job:job-cancel-me");
  assert.equal(job?.state, "cancelled");
  assert.equal(job?.phone_ciphertext, "");
});

test("a retried worker reconciles an uncertain start from the durable request claim", async () => {
  const { env } = environment();
  await handleEnqueueCareCall(await authorizedRequest(request("uncertain-start"), env), env);
  const job = await env.durableStore.get<CareCallJob>("carecall:job:job-uncertain-start");
  assert.ok(job);
  job.state = "starting";
  await env.durableStore.set("carecall:job:job-uncertain-start", job);
  await env.durableStore.set("carecall:request:uncertain-start", { state: "started", run_id: "run-reconciled" });
  await processQueueMessage({ type: "dispatch", job_id: job.id }, env);
  const reconciled = await env.durableStore.get<CareCallJob>("carecall:job:job-uncertain-start");
  assert.equal(reconciled?.state, "ongoing");
  assert.equal(reconciled?.run_id, "run-reconciled");
});

test("a manual authorization expires instead of waiting indefinitely in the queue", async () => {
  const { env } = environment();
  await handleEnqueueCareCall(await authorizedRequest(request("expired-manual"), env), env);
  const job = await env.durableStore.get<CareCallJob>("carecall:job:job-expired-manual");
  assert.ok(job);
  job.authorization_expires_at = new Date(Date.now() - 1000).toISOString();
  await env.durableStore.set("carecall:job:job-expired-manual", job);
  await processQueueMessage({ type: "dispatch", job_id: job.id }, env);
  const expired = await env.durableStore.get<CareCallJob>("carecall:job:job-expired-manual");
  assert.equal(expired?.state, "needs_review");
  assert.equal(expired?.failure_reason, "manual_authorization_expired");
});

test("the public queue worker rejects unsigned delivery", async () => {
  const { env } = environment();
  env.queueVerifier = async () => false;
  const response = await handleQueueWorker(new Request("https://example.test/api/carecall/worker", { method: "POST", body: JSON.stringify({ type: "dispatch", job_id: "job-1" }) }), env);
  assert.equal(response.status, 401);
});
