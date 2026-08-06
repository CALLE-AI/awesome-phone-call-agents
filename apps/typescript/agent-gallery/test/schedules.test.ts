import assert from "node:assert/strict";
import test from "node:test";
import { MemoryDurableStore } from "../api/_lib/durable-store";
import { decryptSchedulePhone, encryptSchedulePhone, nextOccurrence } from "../api/_lib/schedules";
import { handleScheduler } from "../api/carecall/scheduler";
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
    durableStore: store,
  }, now);

  assert.equal(response.status, 200);
  assert.equal((await response.json() as { results: Array<{ state: string }> }).results[0].state, "review_expired");
  assert.equal((await store.get<typeof schedule>(`carecall:schedule:${schedule.id}`))?.status, "needs_review");
  assert.deepEqual(await store.readDueIndex("carecall:schedules:due", now.getTime()), []);
});
