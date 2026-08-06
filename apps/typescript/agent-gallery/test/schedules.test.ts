import assert from "node:assert/strict";
import test from "node:test";
import { MemoryDurableStore } from "../api/_lib/durable-store";
import { decryptSchedulePhone, encryptSchedulePhone, nextEligibleOccurrence, nextOccurrence } from "../api/_lib/schedules";
import { handleScheduler } from "../api/carecall/scheduler";
import { handleSchedules } from "../api/carecall/schedules";
import type { CareCallJob, QueueWakeMessage } from "../api/_lib/call-queue";
import { issueOperatorSession } from "../api/_lib/operator-auth";
import type { CareCallRequest } from "../src/workflows/carecall";
import { isScheduledTimeWithinPermittedWindow } from "../src/workflows/carecall";

test("scheduled phone numbers are encrypted and decrypt only with the configured key", async () => {
  const secret = "schedule-encryption-secret-with-32-characters";
  const encrypted = await encryptSchedulePhone("+6580000000", secret);
  assert.doesNotMatch(encrypted, /6580000000/);
  assert.equal(await decryptSchedulePhone(encrypted, secret), "+6580000000");
  await assert.rejects(() => decryptSchedulePhone(encrypted, "another-encryption-secret-with-32-chars"));
});

test("daily occurrences use Singapore wall-clock time", () => {
  assert.equal(nextOccurrence(new Date("2026-08-06T00:01:00Z"), "daily", "12:30").toISOString(), "2026-08-06T04:30:00.000Z");
});

test("weekday schedules skip Saturday and Sunday", () => {
  assert.equal(nextOccurrence(new Date("2026-08-07T10:00:00Z"), "weekdays", "08:00").toISOString(), "2026-08-10T00:00:00.000Z");
});

test("dated exceptions move a recurring occurrence forward without dialing", () => {
  assert.equal(nextEligibleOccurrence(new Date("2026-08-06T00:01:00Z"), "daily", "12:30", ["2026-08-06"]).toISOString(), "2026-08-07T04:30:00.000Z");
});

test("occurrences reject impossible wall-clock times", () => {
  assert.throws(() => nextOccurrence(new Date("2026-08-07T10:00:00Z"), "daily", "25:90"));
});

test("schedule activation can enforce the senior's permitted wall-clock window", () => {
  assert.equal(isScheduledTimeWithinPermittedWindow("8:00 AM – 8:00 PM", "12:30"), true);
  assert.equal(isScheduledTimeWithinPermittedWindow("8:00 AM – 8:00 PM", "21:00"), false);
  assert.equal(isScheduledTimeWithinPermittedWindow("10:00 PM – 6:00 AM", "23:30"), true);
});

test("due indexes return only due schedules in chronological order", async () => {
  const store = new MemoryDurableStore();
  await store.addToIndex("due", 30, "later"); await store.addToIndex("due", 10, "first"); await store.addToIndex("due", 20, "second");
  assert.deepEqual(await store.readDueIndex("due", 20), ["first", "second"]);
  await store.removeFromIndex("due", "first");
  assert.deepEqual(await store.readDueIndex("due", 20), ["second"]);
});

test("scheduler rejects requests without its host secret", async () => {
  const response = await handleScheduler(new Request("https://example.test/api/carecall/scheduler"), {
    CRON_SECRET: "scheduler-secret",
  });
  assert.equal(response.status, 401);
});

test("scheduler safely expires due schedules whose review date has passed", async () => {
  const store = new MemoryDurableStore();
  const now = new Date("2026-08-06T04:30:00.000Z");
  const schedule = {
    id: "schedule-review-expired",
    status: "active" as const,
    frequency: "daily" as const,
    time_sgt: "12:30",
    next_run: now.toISOString(),
    review_date: "2026-08-06T04:29:59.000Z",
    skip_dates: [],
    phone_ciphertext: "encrypted",
    senior: { id: "senior-1", preferred_name: "Aunty May", language: "English" as const, permitted_call_window: "8:00 AM – 8:00 PM" },
    routine: { id: "routine-1", title: "Lunch", kind: "meal" as const, caregiver_instruction: "Please have lunch.", caregiver_name: "Mei", trust_phrase: "orchid" },
    organisation: { name: "CareCall SG", timezone: "Asia/Singapore" as const },
    created_by: { id: "operator-1", name: "Mei", role: "coordinator", senior_ids: ["senior-1"] },
    created_at: "2026-08-01T00:00:00.000Z",
  };
  await store.set(`carecall:schedule:${schedule.id}`, schedule);
  await store.addToIndex("carecall:schedules:due", now.getTime(), schedule.id);

  const response = await handleScheduler(new Request("https://example.test/api/carecall/scheduler", {
    headers: { authorization: "Bearer scheduler-secret" },
  }), {
    CRON_SECRET: "scheduler-secret",
    CARECALL_DATA_ENCRYPTION_KEY: "schedule-encryption-secret-with-32-characters",
    CARECALL_PUBLIC_BASE_URL: "https://example.test",
    queuePublisher: async () => {},
    durableStore: store,
  }, now);

  assert.equal(response.status, 200);
  assert.equal((await response.json() as { results: Array<{ state: string }> }).results[0].state, "review_expired");
  assert.equal((await store.get<typeof schedule>(`carecall:schedule:${schedule.id}`))?.status, "needs_review");
  assert.deepEqual(await store.readDueIndex("carecall:schedules:due", now.getTime()), []);
});

test("schedule activation queues one occurrence and pause invalidates it", async () => {
  const store = new MemoryDurableStore();
  const messages: QueueWakeMessage[] = [];
  const env = {
    CARECALL_SESSION_SECRET: "test-session-secret-that-is-at-least-32-characters",
    CARECALL_OPERATORS_JSON: JSON.stringify([{ id: "mei-chen", name: "Mei Chen", role: "coordinator", access_code_sha256: "1427b7e058bb398ae674d86981bc0e4f796661abc0ccbba06c3e9ec611f9f07f", senior_ids: ["mdm-lim"] }]),
    CARECALL_DATA_ENCRYPTION_KEY: "schedule-encryption-secret-with-32-characters",
    CARECALL_PUBLIC_BASE_URL: "https://example.test",
    durableStore: store,
    queuePublisher: async (message: QueueWakeMessage) => { messages.push(message); },
  };
  const token = await issueOperatorSession("mei-chen", "test-operator-code", env);
  assert.ok(token);
  const call: CareCallRequest = {
    workflow: "carecall", request_key: "schedule-authorization", organisation: { name: "CareCall SG", timezone: "Asia/Singapore" },
    senior: { id: "mdm-lim", preferred_name: "Mdm Lim", phone_e164: "+6580000000", language: "English", authority_confirmed: true, permitted_call_window: "12:00 AM–11:59 PM" },
    routine: { id: "routine-scheduled", title: "Lunch", kind: "meal", caregiver_instruction: "Please have lunch.", caregiver_name: "Mei", trust_phrase: "orchid" },
    authorization: { exactly_one_call: true, authorized_at: new Date().toISOString() },
  };
  const create = await handleSchedules(new Request("https://example.test/api/carecall/schedules", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ call, frequency: "daily", time_sgt: "23:59", review_date: new Date(Date.now() + 7 * 86_400_000).toISOString(), recurring_authority_confirmed: true, skip_dates: [] }) }), env);
  assert.equal(create.status, 201);
  const schedule = await store.get<{ current_job_id?: string }>("carecall:schedule:schedule-routine-scheduled");
  assert.ok(schedule?.current_job_id);
  const firstJobId = schedule.current_job_id;
  assert.equal(messages[0].type, "dispatch");

  const pause = await handleSchedules(new Request("https://example.test/api/carecall/schedules", { method: "PATCH", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ schedule_id: "schedule-routine-scheduled", status: "paused" }) }), env);
  assert.equal(pause.status, 200);
  assert.equal((await store.get<CareCallJob>(`carecall:job:${firstJobId}`))?.state, "cancelled");

  const resume = await handleSchedules(new Request("https://example.test/api/carecall/schedules", { method: "PATCH", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ schedule_id: "schedule-routine-scheduled", status: "active" }) }), env);
  assert.equal(resume.status, 200);
  const resumed = await store.get<{ current_job_id?: string; status: string }>("carecall:schedule:schedule-routine-scheduled");
  assert.equal(resumed?.status, "active");
  assert.equal((await store.get<CareCallJob>(`carecall:job:${resumed?.current_job_id}`))?.state, "queued");
});
