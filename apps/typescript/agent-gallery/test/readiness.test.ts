import assert from "node:assert/strict";
import test from "node:test";
import type { CareCallJob } from "../api/_lib/call-queue";
import { MemoryDurableStore } from "../api/_lib/durable-store";
import { configurationChecks, handleReadiness } from "../api/_lib/readiness";

const CRON_SECRET = "test-cron-secret-that-is-at-least-32-characters";

function readyEnvironment() {
  return {
    CALLE_ACCESS_TOKEN: "test-provider-token",
    CALLE_SERVER_URL: "https://provider.example.test/mcp",
    CARECALL_SESSION_SECRET: "test-session-secret-that-is-at-least-32-characters",
    CARECALL_OPERATORS_JSON: JSON.stringify([{ id: "operator-1", name: "Operator One", role: "coordinator", access_code_sha256: "a".repeat(64), senior_ids: ["senior-1"] }]),
    CARECALL_DATA_ENCRYPTION_KEY: "test-encryption-key-that-is-at-least-32-characters",
    CARECALL_PUBLIC_BASE_URL: "https://carecall.example.test",
    QSTASH_URL: "https://qstash-us-east-1.upstash.io",
    QSTASH_TOKEN: "test-qstash-token",
    QSTASH_CURRENT_SIGNING_KEY: "test-current-signing-key",
    QSTASH_NEXT_SIGNING_KEY: "test-next-signing-key",
    CRON_SECRET,
    durableStore: new MemoryDurableStore(),
    queuePublisher: async () => {},
  };
}

test("readiness remains protected and reveals no configuration detail without the cron secret", async () => {
  const response = await handleReadiness(new Request("https://carecall.example.test/api/carecall/readiness"), readyEnvironment());
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "unauthorized_readiness" });
});

test("readiness is read-only even with valid host authorization", async () => {
  const response = await handleReadiness(new Request("https://carecall.example.test/api/carecall/readiness", { method: "POST", headers: { authorization: `Bearer ${CRON_SECRET}` } }), readyEnvironment());
  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { error: "method_not_allowed" });
});

test("configuration preflight validates every live-call dependency without returning values", () => {
  const checks = configurationChecks(readyEnvironment());
  assert.ok(Object.values(checks).every(Boolean));
  assert.deepEqual(Object.keys(checks), ["operator_auth", "durable_store", "data_encryption", "call_provider", "public_worker_url", "queue_delivery", "queue_signatures", "reconciliation_auth"]);
});

test("queue delivery accepts a secure regional QStash origin and rejects a path or insecure URL", () => {
  const { queuePublisher: _publisher, ...regional } = readyEnvironment();
  assert.equal(configurationChecks(regional).queue_delivery, true);
  assert.equal(configurationChecks({ ...regional, QSTASH_URL: "https://qstash-us-east-1.upstash.io/v2" }).queue_delivery, false);
  assert.equal(configurationChecks({ ...regional, QSTASH_URL: "http://qstash-us-east-1.upstash.io" }).queue_delivery, false);
});

test("readiness reports an empty healthy queue using counts and states only", async () => {
  const env = readyEnvironment();
  const response = await handleReadiness(new Request("https://carecall.example.test/api/carecall/readiness", { headers: { authorization: `Bearer ${CRON_SECRET}` } }), env);
  assert.equal(response.status, 200);
  const body = await response.json() as { ready: boolean; healthy: boolean; operations: { queue_depth: number; active_call: boolean; needs_review_count: number } };
  assert.equal(body.ready, true);
  assert.equal(body.healthy, true);
  assert.deepEqual(body.operations, {
    queue_depth: 0,
    queue_scan_truncated: false,
    oldest_queued_age_seconds: null,
    active_call: false,
    active_state: null,
    active_age_seconds: null,
    needs_review_count: 0,
    needs_review_scan_truncated: false,
    needs_review_reasons: {},
    alerts: [],
  });
});

test("operational readiness surfaces review work without exposing job or senior identifiers", async () => {
  const env = readyEnvironment();
  const job: CareCallJob = {
    id: "job-private-id",
    source: "manual",
    state: "needs_review",
    request: {
      workflow: "carecall", request_key: "private-request", organisation: { name: "Private Team", timezone: "Asia/Singapore" },
      senior: { id: "private-senior", preferred_name: "Private Name", language: "English", authority_confirmed: true, permitted_call_window: "8:00 AM–8:00 PM" },
      routine: { id: "routine-1", kind: "meal", title: "Meal", caregiver_instruction: "Reminder", caregiver_name: "Private Caregiver", trust_phrase: "private phrase" },
      authorization: { exactly_one_call: true, authorized_at: new Date().toISOString() },
    },
    phone_ciphertext: "",
    operator: { id: "operator-1", name: "Operator One", role: "coordinator", senior_ids: ["private-senior"] },
    scheduled_for: new Date().toISOString(),
    failure_reason: "call_creation_uncertain",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await env.durableStore.set(`carecall:job:${job.id}`, job);
  await env.durableStore.addToIndex("carecall:queue:needs-review", Date.now(), job.id);
  const response = await handleReadiness(new Request("https://carecall.example.test/api/carecall/readiness", { headers: { authorization: `Bearer ${CRON_SECRET}` } }), env);
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.doesNotMatch(text, /private-id|private-senior|Private Name|Private Caregiver|private phrase/);
  const body = JSON.parse(text) as { healthy: boolean; operations: { needs_review_count: number; needs_review_reasons: Record<string, number>; alerts: string[] } };
  assert.equal(body.healthy, false);
  assert.equal(body.operations.needs_review_count, 1);
  assert.equal(body.operations.needs_review_reasons.call_creation_uncertain, 1);
  assert.ok(body.operations.alerts.includes("human_review_required"));
});

test("future recurring occurrences are not reported as a current queue backlog", async () => {
  const env = readyEnvironment();
  for (let index = 0; index < 6; index += 1) {
    const id = `future-job-${index}`;
    await env.durableStore.set(`carecall:job:${id}`, { id, state: "queued", scheduled_for: new Date(Date.now() + 86_400_000).toISOString() });
    await env.durableStore.addToIndex("carecall:queue:ready", Date.now() + 86_400_000, id);
  }
  const response = await handleReadiness(new Request("https://carecall.example.test/api/carecall/readiness", { headers: { authorization: `Bearer ${CRON_SECRET}` } }), env);
  const body = await response.json() as { healthy: boolean; operations: { queue_depth: number; alerts: string[] } };
  assert.equal(body.operations.queue_depth, 0);
  assert.equal(body.healthy, true);
  assert.ok(!body.operations.alerts.includes("queue_backlog"));
});
