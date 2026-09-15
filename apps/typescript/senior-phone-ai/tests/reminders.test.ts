import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryActionAuthorizationStore } from "../lib/safety/authorization";
import { InMemoryReminderStore, ReminderService, reminderActionRequest, type ReminderRequest } from "../lib/tools/reminders";

const base: ReminderRequest = {
  authorizationId: "authorization-1",
  channel: "sms",
  destinationE164: "+12025550123",
  idempotencyKey: "reminder:one",
  message: "Library visit",
  principalId: "family-1",
  scheduledFor: "2026-09-12T00:30:00.000Z",
  seniorId: "senior-1",
  timezone: "Australia/Sydney",
};

function setup() {
  const authorizations = new InMemoryActionAuthorizationStore({ createId: () => base.authorizationId });
  const store = new InMemoryReminderStore((senior, principal) => senior === base.seniorId && principal === base.principalId);
  const service = new ReminderService(authorizations, store);
  return { authorizations, service, store };
}

test("confirmed reminder is created once and lists in schedule order", async () => {
  const { authorizations, service } = setup();
  authorizations.propose(reminderActionRequest(base));
  authorizations.confirm(base.authorizationId, base.principalId, true);
  const created = await service.create(base);
  assert.equal(created.status, "pending");
  assert.equal((await service.create(base)).id, created.id);
  assert.deepEqual((await service.list(base.seniorId, base.principalId)).map((item) => item.id), [created.id]);
});

test("changed or unconfirmed reminders fail closed", async () => {
  const { authorizations, service } = setup();
  authorizations.propose(reminderActionRequest(base));
  authorizations.confirm(base.authorizationId, base.principalId, true);
  await assert.rejects(service.create({ ...base, message: "Changed message" }), /mismatched/);

  const second = setup();
  second.authorizations.propose(reminderActionRequest(base));
  await assert.rejects(second.service.create(base), /denied/);
  await assert.rejects(second.service.create(base), /reservation is canceled/);
  await assert.rejects(second.service.create({
    ...base,
    authorizationId: "authorization-invalid-timezone",
    idempotencyKey: "reminder:invalid-timezone",
    timezone: "Sydney local time",
  }), /valid IANA timezone/);
});

test("authorized cancellation wins only before delivery starts", async () => {
  const { authorizations, service, store } = setup();
  authorizations.propose(reminderActionRequest(base));
  authorizations.confirm(base.authorizationId, base.principalId, true);
  const created = await service.create(base);
  store.setStatus(created.id, "queued");
  assert.equal(await service.cancel(created.id, base.seniorId, base.principalId), "already_started");
  await assert.rejects(service.cancel(created.id, base.seniorId, "outsider"), /access denied/);
});

test("pending reminder cancellation is idempotent", async () => {
  const { authorizations, service } = setup();
  authorizations.propose(reminderActionRequest(base));
  authorizations.confirm(base.authorizationId, base.principalId, true);
  const created = await service.create(base);
  assert.equal(await service.cancel(created.id, base.seniorId, base.principalId), "canceled");
  assert.equal(await service.cancel(created.id, base.seniorId, base.principalId), "not_found");
});
