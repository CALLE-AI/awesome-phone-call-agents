import { prisma } from "../db/client.js";

/** Thrown when a slot was expected to be OPEN but the guarded update matched 0 rows — someone else already took it. */
export class SlotUnavailableError extends Error {
  constructor(public readonly slotId: string) {
    super(`Slot ${slotId} is no longer OPEN; it was taken by a concurrent booking.`);
    this.name = "SlotUnavailableError";
  }
}

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

/**
 * Books a contact into a slot atomically: the slot is only flipped OPEN->BOOKED
 * if it is still OPEN at the moment of the update, so two concurrent accepts
 * (e.g. two waterfall candidates, or a reschedule racing a backfill) can never
 * both succeed in booking the same slot. Throws SlotUnavailableError otherwise.
 */
export async function bookContactIntoSlot(options: {
  businessId: string;
  contactId: string;
  slotId: string;
  confirmed?: boolean;
}): Promise<{ appointmentId: string }> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.slot.updateMany({
      where: { id: options.slotId, status: "OPEN" },
      data: { status: "BOOKED" },
    });
    if (count === 0) {
      throw new SlotUnavailableError(options.slotId);
    }
    const appointment = await tx.appointment.create({
      data: {
        businessId: options.businessId,
        contactId: options.contactId,
        slotId: options.slotId,
        status: options.confirmed === false ? "SCHEDULED" : "CONFIRMED",
        confirmationCallStatus: options.confirmed === false ? "NOT_CALLED" : "CONFIRMED",
      },
    });
    return { appointmentId: appointment.id };
  });
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
