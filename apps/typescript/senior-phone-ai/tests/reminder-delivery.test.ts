import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryActionAuthorizationStore } from "../lib/safety/authorization";
import { ReminderDeliveryScheduler, type ReminderDeliveryAdapter } from "../lib/scheduler/reminder-delivery";
import { InMemoryReminderStore, ReminderService, reminderActionRequest, type ReminderRequest } from "../lib/tools/reminders";

const now = Date.parse("2026-09-11T01:00:00.000Z");
const allowAll = { allows: () => true };
const base: ReminderRequest = {
  authorizationId: "authorization-delivery",
  channel: "call",
  destinationE164: "+12025550123",
  idempotencyKey: "reminder:delivery:one",
  message: "It is time for the library visit.",
  principalId: "family-1",
  scheduledFor: "2026-09-11T00:59:00.000Z",
  seniorId: "senior-1",
  timezone: "Australia/Sydney",
};

async function confirmedReminder(store: InMemoryReminderStore, request = base) {
  const authorizations = new InMemoryActionAuthorizationStore({ createId: () => request.authorizationId });
  authorizations.propose(reminderActionRequest(request));
  authorizations.confirm(request.authorizationId, request.principalId, true);
  return new ReminderService(authorizations, store).create(request);
}

test("concurrent scheduler runs dispatch one confirmed reminder exactly once", async () => {
  const store = new InMemoryReminderStore(() => true, () => now);
  const reminder = await confirmedReminder(store);
  let calls = 0;
  const call: ReminderDeliveryAdapter = {
    async deliver(record) {
      calls += 1;
      assert.equal(record.idempotencyKey, base.idempotencyKey);
      return { status: "queued", providerReference: "call-safe" };
    },
  };
  const sms: ReminderDeliveryAdapter = { async deliver() { throw new Error("wrong channel"); } };
  const firstProcess = new ReminderDeliveryScheduler(store, { call, sms }, allowAll);
  const restartedProcess = new ReminderDeliveryScheduler(store, { call, sms }, allowAll);

  await Promise.all([firstProcess.runDue(new Date(now)), restartedProcess.runDue(new Date(now))]);
  assert.equal(calls, 1);
  assert.equal((await store.list(base.seniorId, base.principalId)).find((item) => item.id === reminder.id)?.status, "queued");
});

test("cancellation and late-run policy prevent provider dispatch", async () => {
  const store = new InMemoryReminderStore(() => true, () => now);
  const canceled = await confirmedReminder(store);
  assert.equal(store.cancel(canceled.id, base.seniorId, base.principalId), "canceled");
  const late = await confirmedReminder(store, {
    ...base,
    authorizationId: "authorization-late",
    idempotencyKey: "reminder:delivery:late",
    scheduledFor: "2026-09-11T00:30:00.000Z",
  });
  let deliveries = 0;
  const adapter: ReminderDeliveryAdapter = { async deliver() { deliveries += 1; return { status: "completed" }; } };
  const result = await new ReminderDeliveryScheduler(store, { call: adapter, sms: adapter }, allowAll).runDue(new Date(now));

  assert.deepEqual(result, { blocked: 0, delivered: 0, expired: 1, unknown: 0 });
  assert.equal(deliveries, 0);
  assert.equal((await store.list(base.seniorId, base.principalId)).find((item) => item.id === late.id)?.status, "failed");
});

test("uncertain provider delivery is retained and never retried", async () => {
  const store = new InMemoryReminderStore(() => true, () => now);
  const reminder = await confirmedReminder(store);
  let attempts = 0;
  const adapter: ReminderDeliveryAdapter = { async deliver() { attempts += 1; throw new Error("uncertain"); } };
  const scheduler = new ReminderDeliveryScheduler(store, { call: adapter, sms: adapter }, allowAll);

  assert.deepEqual(await scheduler.runDue(new Date(now)), { blocked: 0, delivered: 0, expired: 0, unknown: 1 });
  assert.deepEqual(await scheduler.runDue(new Date(now)), { blocked: 0, delivered: 0, expired: 0, unknown: 0 });
  assert.equal(attempts, 1);
  assert.equal((await store.list(base.seniorId, base.principalId)).find((item) => item.id === reminder.id)?.status, "unknown");
});

test("scheduler routes SMS and retries only definite retryable failures within its bound", async () => {
  const store = new InMemoryReminderStore(() => true, () => now);
  await confirmedReminder(store, {
    ...base,
    authorizationId: "authorization-sms",
    channel: "sms",
    idempotencyKey: "reminder:delivery:sms",
  });
  let smsAttempts = 0;
  const sms: ReminderDeliveryAdapter = {
    async deliver() {
      smsAttempts += 1;
      return smsAttempts < 3
        ? { status: "failed", retryable: true }
        : { status: "completed", providerReference: "sms-safe" };
    },
  };
  const call: ReminderDeliveryAdapter = { async deliver() { throw new Error("wrong channel"); } };

  assert.deepEqual(
    await new ReminderDeliveryScheduler(store, { call, sms }, allowAll).runDue(new Date(now)),
    { blocked: 0, delivered: 1, expired: 0, unknown: 0 },
  );
  assert.equal(smsAttempts, 3);
});

test("current channel preference is checked after claim and before delivery", async () => {
  const store = new InMemoryReminderStore(() => true, () => now);
  const reminder = await confirmedReminder(store);
  let deliveries = 0;
  const adapter: ReminderDeliveryAdapter = { async deliver() { deliveries += 1; return { status: "completed" }; } };
  const scheduler = new ReminderDeliveryScheduler(store, { call: adapter, sms: adapter }, { allows: () => false });

  assert.deepEqual(await scheduler.runDue(new Date(now)), { blocked: 1, delivered: 0, expired: 0, unknown: 0 });
  assert.equal(deliveries, 0);
  assert.equal((await store.list(base.seniorId, base.principalId)).find((item) => item.id === reminder.id)?.status, "failed");
});
