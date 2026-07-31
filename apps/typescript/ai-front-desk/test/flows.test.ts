import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/db/client.js";
import { confirmOne } from "../src/flows/confirm/confirmFlow.js";
import { startBackfillForSlot } from "../src/flows/backfill/backfillFlow.js";
import { qualifyOne } from "../src/flows/qualify/qualifyFlow.js";
import { makeBusiness, makeContact, makeSlot, makeAppointment } from "./fixtures.js";

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

test("confirmOne: mock='attend' confirms the appointment and leaves the slot booked", async () => {
  const business = await makeBusiness();
  const contact = await makeContact(business.id, "Ava", "+15550000001");
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
  const contact = await makeContact(business.id, "Ben", "+15550000002");
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

  const first = await makeContact(business.id, "Elena", "+15550000010");
  const second = await makeContact(business.id, "Farid", "+15550000011");
  const third = await makeContact(business.id, "Grace", "+15550000012");

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
  const contact = await makeContact(business.id, "Hana", "+15550000020");
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
