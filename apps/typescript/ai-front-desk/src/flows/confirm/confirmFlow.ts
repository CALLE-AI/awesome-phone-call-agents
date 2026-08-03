import { runCall } from "../../calle/client.js";
import { prisma } from "../../db/client.js";
import { freeSlotFromAppointment } from "../../services/booking.service.js";
import { startBackfillForSlot } from "../backfill/backfillFlow.js";
import { buildConfirmTask } from "./prompt.js";

export interface ConfirmOutcome {
  appointmentId: string;
  callLogId: string;
  result: "confirmed" | "rescheduled" | "cancelled_backfilling" | "no_answer" | "failed";
}

/** Dry-run mock: confirms attendance. Pass mock="decline" to exercise the cancel→backfill branch offline. */
export async function confirmOne(appointmentId: string, mock: "attend" | "decline" = "attend"): Promise<ConfirmOutcome> {
  const appointment = await prisma.appointment.findUniqueOrThrow({
    where: { id: appointmentId },
    include: { contact: true, slot: true, business: true },
  });
  if (appointment.slot === null) {
    throw new Error(`Appointment ${appointmentId} has no slot; nothing to confirm.`);
  }

  const alternativeSlots = await prisma.slot.findMany({
    where: {
      businessId: appointment.businessId,
      status: "OPEN",
      serviceType: appointment.slot.serviceType,
      startsAt: { gt: new Date() },
    },
    orderBy: { startsAt: "asc" },
    take: 2,
  });

  await prisma.appointment.update({ where: { id: appointmentId }, data: { confirmationCallStatus: "CALLING" } });

  const { task, resultSchema } = buildConfirmTask({
    businessName: appointment.business.name,
    timezone: appointment.business.timezone,
    contactName: appointment.contact.name,
    appointmentSlot: appointment.slot,
    alternativeSlots,
  });

  const call = await runCall({
    flow: "CONFIRM",
    businessId: appointment.businessId,
    phone: appointment.contact.phone,
    task,
    resultSchema,
    appointmentId,
    dryRunResult:
      mock === "attend"
        ? { will_attend: "yes", wants_reschedule: "no", chosen_alternative: "", reached_voicemail: "no" }
        : { will_attend: "no", wants_reschedule: "no", chosen_alternative: "", reached_voicemail: "no" },
    idempotencyKey: `confirm_${appointmentId}_${Date.now()}`,
  });

  const parsed = call.structuredResult ?? {};
  const willAttend = String(parsed["will_attend"] ?? "unknown");
  const chosenAlternative = String(parsed["chosen_alternative"] ?? "");

  if (call.status !== "completed" && call.status !== "dry_run") {
    await prisma.appointment.update({ where: { id: appointmentId }, data: { confirmationCallStatus: "FAILED" } });
    return { appointmentId, callLogId: call.callLogId, result: "failed" };
  }

  if (willAttend === "yes") {
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: "CONFIRMED", confirmationCallStatus: "CONFIRMED" },
    });
    return { appointmentId, callLogId: call.callLogId, result: "confirmed" };
  }

  if (willAttend === "no") {
    const optionMatch = /^option_(\d+)$/.exec(chosenAlternative);
    const chosenSlot = optionMatch ? alternativeSlots[Number(optionMatch[1]) - 1] : undefined;
    if (chosenSlot !== undefined) {
      const freedSlotId = appointment.slotId;
      await prisma.appointment.update({
        where: { id: appointmentId },
        data: { slotId: chosenSlot.id, status: "CONFIRMED", confirmationCallStatus: "CONFIRMED" },
      });
      await prisma.slot.update({ where: { id: chosenSlot.id }, data: { status: "BOOKED" } });
      if (freedSlotId !== null) {
        await prisma.slot.update({ where: { id: freedSlotId }, data: { status: "OPEN" } });
        void startBackfillForSlot(freedSlotId).catch((error) => console.error("[backfill] failed:", error));
      }
      return { appointmentId, callLogId: call.callLogId, result: "rescheduled" };
    }
    await prisma.appointment.update({ where: { id: appointmentId }, data: { confirmationCallStatus: "DECLINED" } });
    const freedSlotId = await freeSlotFromAppointment(appointmentId, "CANCELLED");
    if (freedSlotId !== null) {
      void startBackfillForSlot(freedSlotId).catch((error) => console.error("[backfill] failed:", error));
    }
    return { appointmentId, callLogId: call.callLogId, result: "cancelled_backfilling" };
  }

  await prisma.appointment.update({ where: { id: appointmentId }, data: { confirmationCallStatus: "NO_ANSWER" } });
  return { appointmentId, callLogId: call.callLogId, result: "no_answer" };
}

/** Cron entry point: confirm every unconfirmed appointment starting within the next `windowHours`. */
export async function runConfirmSweep(windowHours = 24): Promise<ConfirmOutcome[]> {
  const now = new Date();
  const horizon = new Date(now.getTime() + windowHours * 60 * 60 * 1000);
  const due = await prisma.appointment.findMany({
    where: {
      status: "SCHEDULED",
      confirmationCallStatus: "NOT_CALLED",
      slot: { startsAt: { gt: now, lte: horizon } },
    },
    select: { id: true },
  });
  console.log(`[confirm-sweep] ${due.length} appointment(s) due for confirmation`);
  const outcomes: ConfirmOutcome[] = [];
  for (const { id } of due) {
    outcomes.push(await confirmOne(id));
  }
  return outcomes;
}
