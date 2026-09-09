// Demo seed: Riverside Dental Clinic. All phone numbers are fictional
// (+1555... reserved range). Live calls never dial these numbers — see
// LIVE_CALL_OVERRIDE_PHONE in .env.example.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function daysFromNow(days: number, hour: number, minute = 0): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date;
}

async function main(): Promise<void> {
  await prisma.callLog.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.waitlistEntry.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.slot.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.business.deleteMany();

  const business = await prisma.business.create({
    data: {
      name: "Riverside Dental Clinic",
      timezone: "America/New_York",
      phone: "+15550100000",
      businessType: "CLINIC",
    },
  });

  const [ava, ben, chloe, dan, elena, farid, grace, hana] = await Promise.all(
    [
      { name: "Ava Martinez", phone: "+15550100001" },
      { name: "Ben Carter", phone: "+15550100002" },
      { name: "Chloe Nguyen", phone: "+15550100003" },
      { name: "Dan Okafor", phone: "+15550100004" },
      { name: "Elena Petrova", phone: "+15550100005" },
      { name: "Farid Rahman", phone: "+15550100006" },
      { name: "Grace Liu", phone: "+15550100007" },
      { name: "Hana Suzuki", phone: "+15550100008" },
    ].map((contact) => prisma.contact.create({ data: { ...contact, businessId: business.id } })),
  );

  const slot = (days: number, hour: number, serviceType: string, status: string) =>
    prisma.slot.create({
      data: {
        businessId: business.id,
        startsAt: daysFromNow(days, hour),
        endsAt: daysFromNow(days, hour + 1),
        serviceType,
        status,
      },
    });

  const slotConfirmed = await slot(1, 9, "Cleaning", "BOOKED"); // already confirmed
  const slotNearing = await slot(3, 14, "Cleaning", "BOOKED"); // confirm-flow demo beat
  const slotToCancel = await slot(2, 11, "Check-up", "BOOKED"); // backfill demo beat
  const slotBackground = await slot(4, 10, "Whitening", "BOOKED"); // visual noise
  await slot(5, 15, "Cleaning", "OPEN"); // open slot for qualify flow / reschedule offers
  await slot(6, 10, "Check-up", "OPEN");

  await prisma.appointment.create({
    data: {
      businessId: business.id,
      contactId: ava!.id,
      slotId: slotConfirmed.id,
      status: "CONFIRMED",
      confirmationCallStatus: "CONFIRMED",
    },
  });
  await prisma.appointment.create({
    data: {
      businessId: business.id,
      contactId: ben!.id,
      slotId: slotNearing.id,
      status: "SCHEDULED",
      confirmationCallStatus: "NOT_CALLED",
    },
  });
  await prisma.appointment.create({
    data: {
      businessId: business.id,
      contactId: chloe!.id,
      slotId: slotToCancel.id,
      status: "SCHEDULED",
      confirmationCallStatus: "NOT_CALLED",
    },
  });
  await prisma.appointment.create({
    data: {
      businessId: business.id,
      contactId: dan!.id,
      slotId: slotBackground.id,
      status: "SCHEDULED",
      confirmationCallStatus: "NOT_CALLED",
    },
  });

  // Waitlist for Check-up (matches slotToCancel) in priority order.
  await prisma.waitlistEntry.create({
    data: { businessId: business.id, contactId: elena!.id, desiredServiceType: "Check-up", priority: 1 },
  });
  await prisma.waitlistEntry.create({
    data: { businessId: business.id, contactId: farid!.id, desiredServiceType: "Check-up", priority: 2 },
  });
  await prisma.waitlistEntry.create({
    data: { businessId: business.id, contactId: grace!.id, desiredServiceType: "Check-up", priority: 3 },
  });

  await prisma.lead.create({
    data: {
      businessId: business.id,
      contactId: hana!.id,
      rawInquiry: "Hi, do you take new patients? I think I need a filling looked at.",
      status: "NEW",
    },
  });

  console.log("Seeded: Riverside Dental Clinic with 8 contacts, 6 slots, 4 appointments, 3 waitlist entries, 1 lead.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
