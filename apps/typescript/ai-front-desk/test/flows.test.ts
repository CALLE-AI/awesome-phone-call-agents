import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/db/client.js";
import { confirmOne } from "../src/flows/confirm/confirmFlow.js";
import { startBackfillForSlot } from "../src/flows/backfill/backfillFlow.js";
import { qualifyOne } from "../src/flows/qualify/qualifyFlow.js";
import { startFakeCalle } from "../fake/calle-server.js";
import { makeBusiness, makeContact, makeSlot, makeAppointment } from "./fixtures.js";

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

const LIVE_PHONE = "+15550109999"; // matches test/test.env LIVE_CALL_OVERRIDE_PHONE; live calls always route here

async function withFakeCalleLive<T>(scripts: Parameters<typeof startFakeCalle>[0], run: () => Promise<T>): Promise<T> {
  const originalBaseUrl = process.env.CALLE_BASE_URL;
  const originalDryRun = process.env.CALLE_DRY_RUN;
  const fake = await startFakeCalle(scripts);
  try {
    process.env.CALLE_BASE_URL = fake.baseUrl;
    process.env.CALLE_DRY_RUN = "false";
    return await run();
  } finally {
    process.env.CALLE_BASE_URL = originalBaseUrl;
    process.env.CALLE_DRY_RUN = originalDryRun;
    await fake.close();
  }
}

test("confirmOne: mock='attend' confirms the appointment and leaves the slot booked", async () => {
  const business = await makeBusiness();
  const contact = await makeContact(business.id, "Ava", "+15550100001");
  const slot = await makeSlot(business.id, { startsAt: hoursFromNow(20) });
  const appointment = await makeAppointment({ businessId: business.id, contactId: contact.id, slotId: slot.id });

  const outcome = await confirmOne(appointment.id, "attend");
  assert.equal(outcome.result, "confirmed");

  const updated = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
  assert.equal(updated.status, "CONFIRMED");
  assert.equal(updated.confirmationCallStatus, "CONFIRMED");
});

test("confirmOne: mock='decline' with no alternative slots cancels the appointment and frees the slot", async () => {
  const business = await makeBusiness();
  const contact = await makeContact(business.id, "Ben", "+15550100002");
  const slot = await makeSlot(business.id, { startsAt: hoursFromNow(20), serviceType: "Check-up" });
  const appointment = await makeAppointment({ businessId: business.id, contactId: contact.id, slotId: slot.id });

  const outcome = await confirmOne(appointment.id, "decline");
  assert.equal(outcome.result, "cancelled_backfilling");

  const updatedAppointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
  assert.equal(updatedAppointment.status, "CANCELLED");
  assert.equal(updatedAppointment.slotId, null);

  const updatedSlot = await prisma.slot.findUniqueOrThrow({ where: { id: slot.id } });
  assert.equal(updatedSlot.status, "OPEN");
});

test("startBackfillForSlot: waterfall skips decliners in priority order and books the first acceptor", async () => {
  const business = await makeBusiness();
  const slot = await makeSlot(business.id, { startsAt: hoursFromNow(48), serviceType: "Check-up", status: "OPEN" });

  const first = await makeContact(business.id, "Elena", "+15550100010");
  const second = await makeContact(business.id, "Farid", "+15550100011");
  const third = await makeContact(business.id, "Grace", "+15550100012");

  // Priority 1 and 2 should be dry-run-scripted to decline (all but the last
  // candidate decline, per backfillFlow's dry-run mock convention); priority 3 accepts.
  await prisma.waitlistEntry.create({ data: { businessId: business.id, contactId: first.id, desiredServiceType: "Check-up", priority: 1 } });
  await prisma.waitlistEntry.create({ data: { businessId: business.id, contactId: second.id, desiredServiceType: "Check-up", priority: 2 } });
  await prisma.waitlistEntry.create({ data: { businessId: business.id, contactId: third.id, desiredServiceType: "Check-up", priority: 3 } });

  const outcome = await startBackfillForSlot(slot.id);
  assert.equal(outcome.filled, true);
  assert.equal(outcome.attempts.length, 3);
  assert.deepEqual(
    outcome.attempts.map((a) => a.accepted),
    [false, false, true],
  );
  assert.equal(outcome.attempts[2]!.contactName, "Grace");

  const bookedSlot = await prisma.slot.findUniqueOrThrow({ where: { id: slot.id } });
  assert.equal(bookedSlot.status, "BOOKED");

  const entries = await prisma.waitlistEntry.findMany({ where: { businessId: business.id }, orderBy: { priority: "asc" } });
  assert.deepEqual(
    entries.map((e) => e.status),
    ["DECLINED", "DECLINED", "BOOKED"],
  );
});

test("startBackfillForSlot: leaves the slot OPEN and unbooked when there are no waitlist candidates", async () => {
  const business = await makeBusiness();
  const slot = await makeSlot(business.id, { startsAt: hoursFromNow(48), serviceType: "Whitening", status: "OPEN" });

  const outcome = await startBackfillForSlot(slot.id);
  assert.equal(outcome.filled, false);
  assert.equal(outcome.attempts.length, 0);

  const stillOpen = await prisma.slot.findUniqueOrThrow({ where: { id: slot.id } });
  assert.equal(stillOpen.status, "OPEN");
});

test("qualifyOne: books the lead into the next open slot when interested and a slot exists", async () => {
  const business = await makeBusiness();
  const contact = await makeContact(business.id, "Hana", "+15550100020");
  await makeSlot(business.id, { startsAt: hoursFromNow(72), serviceType: "Cleaning", status: "OPEN" });
  const lead = await prisma.lead.create({
    data: { businessId: business.id, contactId: contact.id, rawInquiry: "Do you take new patients?" },
  });

  const outcome = await qualifyOne(lead.id);
  assert.equal(outcome.result, "booked");

  const updatedLead = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  assert.equal(updatedLead.status, "BOOKED");

  const appointment = await prisma.appointment.findFirst({ where: { contactId: contact.id } });
  assert.ok(appointment !== null);
  assert.equal(appointment!.status, "CONFIRMED");
});

test("confirmOne: an untrusted call result (not completed) does not confirm the appointment", async () => {
  const business = await makeBusiness();
  const contact = await makeContact(business.id, "Ivy", LIVE_PHONE);
  const slot = await makeSlot(business.id, { startsAt: hoursFromNow(20) });
  const appointment = await makeAppointment({ businessId: business.id, contactId: contact.id, slotId: slot.id });

  const outcome = await withFakeCalleLive(
    [{ phone: LIVE_PHONE, status: "failed" }],
    () => confirmOne(appointment.id, "attend"),
  );

  assert.equal(outcome.result, "failed");
  assert.ok(outcome.reason !== undefined);

  const updated = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
  assert.equal(updated.status, "SCHEDULED");
  assert.equal(updated.confirmationCallStatus, "FAILED");
});

test("startBackfillForSlot: an untrusted result halts the waterfall (NEEDS_REVIEW) instead of advancing to the next candidate", async () => {
  const business = await makeBusiness();
  const slot = await makeSlot(business.id, { startsAt: hoursFromNow(48), serviceType: "Check-up", status: "OPEN" });

  const first = await makeContact(business.id, "Jai", LIVE_PHONE);
  const second = await makeContact(business.id, "Kim", "+15550100099");

  const firstEntry = await prisma.waitlistEntry.create({
    data: { businessId: business.id, contactId: first.id, desiredServiceType: "Check-up", priority: 1 },
  });
  await prisma.waitlistEntry.create({
    data: { businessId: business.id, contactId: second.id, desiredServiceType: "Check-up", priority: 2 },
  });

  const outcome = await withFakeCalleLive(
    [{ phone: LIVE_PHONE, status: "failed" }],
    () => startBackfillForSlot(slot.id),
  );

  assert.equal(outcome.filled, false);
  assert.equal(outcome.attempts.length, 1);
  assert.ok(outcome.haltedReason !== undefined);

  const haltedEntry = await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: firstEntry.id } });
  assert.equal(haltedEntry.status, "NEEDS_REVIEW");

  // The waterfall stopped instead of advancing: the second (lower-priority) candidate was never touched.
  const secondEntry = await prisma.waitlistEntry.findFirst({ where: { contactId: second.id } });
  assert.equal(secondEntry!.status, "WAITING");

  const stillOpenSlot = await prisma.slot.findUniqueOrThrow({ where: { id: slot.id } });
  assert.equal(stillOpenSlot.status, "OPEN");
});
