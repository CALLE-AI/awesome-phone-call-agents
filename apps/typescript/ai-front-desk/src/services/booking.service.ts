import { prisma } from "../db/client.js";

export async function freeSlotFromAppointment(appointmentId: string, newStatus: "CANCELLED" | "NO_SHOW"): Promise<string | null> {
  const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
  const slotId = appointment.slotId;
  await prisma.appointment.update({
    where: { id: appointmentId },
    data: { status: newStatus, slotId: null },
  });
  if (slotId !== null) {
    await prisma.slot.update({ where: { id: slotId }, data: { status: "OPEN" } });
  }
  return slotId;
}

export async function bookContactIntoSlot(options: {
  businessId: string;
  contactId: string;
  slotId: string;
  confirmed?: boolean;
}): Promise<{ appointmentId: string }> {
  const appointment = await prisma.appointment.create({
    data: {
      businessId: options.businessId,
      contactId: options.contactId,
      slotId: options.slotId,
      status: options.confirmed === false ? "SCHEDULED" : "CONFIRMED",
      confirmationCallStatus: options.confirmed === false ? "NOT_CALLED" : "CONFIRMED",
    },
  });
  await prisma.slot.update({ where: { id: options.slotId }, data: { status: "BOOKED" } });
  return { appointmentId: appointment.id };
}

export async function findNextOpenSlot(businessId: string, serviceType?: string) {
  return prisma.slot.findFirst({
    where: {
      businessId,
      status: "OPEN",
      startsAt: { gt: new Date() },
      ...(serviceType ? { serviceType } : {}),
    },
    orderBy: { startsAt: "asc" },
  });
}

export function formatSlot(slot: { startsAt: Date; endsAt: Date; serviceType: string }, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
  return `${fmt.format(slot.startsAt)} (${slot.serviceType})`;
}
