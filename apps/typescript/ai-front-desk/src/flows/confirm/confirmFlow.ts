import { runCall } from "../../calle/client.js";
import { assessEvidence } from "../../calle/evidence.js";
import { prisma } from "../../db/client.js";
import { freeSlotFromAppointment, SlotUnavailableError } from "../../services/booking.service.js";
import { startBackfillForSlot } from "../backfill/backfillFlow.js";
import { buildConfirmTask } from "./prompt.js";

export interface ConfirmOutcome {
  appointmentId: string;
  callLogId: string | null;
  result: "confirmed" | "rescheduled" | "cancelled_backfilling" | "no_answer" | "failed" | "already_in_progress";
  reason?: string | undefined;
}

/**
 * Moves an appointment onto a different, currently-OPEN slot, atomically.
 * Guards the target slot's OPEN->BOOKED flip the same way bookContactIntoSlot
 * does, so a reschedule can never land on a slot someone else just took.
 */
async function rescheduleAppointmentToSlot(appointmentId: string, targetSlotId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.slot.updateMany({ where: { id: targetSlotId, status: "OPEN" }, data: { status: "BOOKED" } });
    if (count === 0) {
      throw new SlotUnavailableError(targetSlotId);
    }
    await tx.appointment.update({
      where: { id: appointmentId },
      data: { slotId: targetSlotId, status: "CONFIRMED", confirmationCallStatus: "CONFIRMED" },
    });
  });
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

  // Atomic claim: only one caller can move this appointment out of
  // NOT_CALLED/pending states. A retry or double-click that lands here while
  // a call is already in flight (or already resolved) is a no-op instead of
  // placing a second call.
  const claimed = await prisma.appointment.updateMany({
    where: { id: appointmentId, confirmationCallStatus: "NOT_CALLED" },
    data: { confirmationCallStatus: "CALLING" },
  });
  if (claimed.count === 0) {
    return { appointmentId, callLogId: null, result: "already_in_progress" };
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
    idempotencyKey: `confirm:${appointmentId}`,
  });

  const evidence = assessEvidence(call, resultSchema);
  if (!evidence.trusted) {
    await prisma.appointment.update({ where: { id: appointmentId }, data: { confirmationCallStatus: "FAILED" } });
    return { appointmentId, callLogId: call.callLogId, result: "failed", reason: evidence.reason };
  }

  const parsed = call.structuredResult ?? {};
  const willAttend = String(parsed["will_attend"] ?? "unknown");
  const chosenAlternative = String(parsed["chosen_alternative"] ?? "");
  const reachedVoicemail = String(parsed["reached_voicemail"] ?? "no") === "yes";

  // Voicemail is never a real confirmation, no matter what will_attend says.
  if (reachedVoicemail) {
    await prisma.appointment.update({ where: { id: appointmentId }, data: { confirmationCallStatus: "NO_ANSWER" } });
    return { appointmentId, callLogId: call.callLogId, result: "no_answer" };
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
      try {
        await rescheduleAppointmentToSlot(appointmentId, chosenSlot.id);
      } catch (error) {
        if (error instanceof SlotUnavailableError) {
          await prisma.appointment.update({ where: { id: appointmentId }, data: { confirmationCallStatus: "FAILED" } });
          return { appointmentId, callLogId: call.callLogId, result: "failed", reason: error.message };
        }
        throw error;
      }
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
    try {
      outcomes.push(await confirmOne(id));
    } catch (error) {
      console.error(`[confirm-sweep] appointment ${id} failed:`, error);
      outcomes.push({ appointmentId: id, callLogId: null, result: "failed", reason: String(error) });
    }
  }
  return outcomes;
}
