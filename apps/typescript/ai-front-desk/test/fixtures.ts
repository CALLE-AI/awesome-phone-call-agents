import { prisma } from "../src/db/client.js";

export async function makeBusiness(overrides: Partial<{ name: string; timezone: string; businessType: string }> = {}) {
  return prisma.business.create({
    data: {
      name: overrides.name ?? "Test Clinic",
      timezone: overrides.timezone ?? "America/New_York",
      phone: "+15550000000",
      businessType: overrides.businessType ?? "CLINIC",
    },
  });
}

export async function makeContact(businessId: string, name: string, phone: string) {
  return prisma.contact.create({ data: { businessId, name, phone } });
}

export async function makeSlot(
  businessId: string,
  options: { startsAt: Date; serviceType?: string; status?: string },
) {
  return prisma.slot.create({
    data: {
      businessId,
      startsAt: options.startsAt,
      endsAt: new Date(options.startsAt.getTime() + 60 * 60 * 1000),
      serviceType: options.serviceType ?? "Cleaning",
      status: options.status ?? "OPEN",
    },
  });
}

export async function makeAppointment(options: {
  businessId: string;
  contactId: string;
  slotId: string;
  status?: string;
  confirmationCallStatus?: string;
}) {
  const appointment = await prisma.appointment.create({
    data: {
      businessId: options.businessId,
      contactId: options.contactId,
      slotId: options.slotId,
      status: options.status ?? "SCHEDULED",
      confirmationCallStatus: options.confirmationCallStatus ?? "NOT_CALLED",
    },
  });
  await prisma.slot.update({ where: { id: options.slotId }, data: { status: "BOOKED" } });
  return appointment;
}
