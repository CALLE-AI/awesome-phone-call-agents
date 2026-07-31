import { runCall } from "../../calle/client.js";
import { prisma } from "../../db/client.js";
import { bookContactIntoSlot } from "../../services/booking.service.js";
import { buildBackfillTask } from "./prompt.js";

export interface BackfillAttempt {
  waitlistEntryId: string;
  contactName: string;
  callLogId: string;
  accepted: boolean;
}

export interface BackfillOutcome {
  slotId: string;
  attempts: BackfillAttempt[];
  filled: boolean;
  bookedAppointmentId: string | null;
}

/**
 * Priority call waterfall: call WAITING waitlist entries for the slot's service
 * type in priority order until one accepts. In dry-run mode every candidate
 * declines except the last, so the full waterfall is exercised offline.
 */
export async function startBackfillForSlot(slotId: string): Promise<BackfillOutcome> {
  const slot = await prisma.slot.findUniqueOrThrow({ where: { id: slotId }, include: { business: true } });
  if (slot.status !== "OPEN") {
    return { slotId, attempts: [], filled: false, bookedAppointmentId: null };
  }

  const candidates = await prisma.waitlistEntry.findMany({
    where: { businessId: slot.businessId, status: "WAITING", desiredServiceType: slot.serviceType },
    orderBy: { priority: "asc" },
    include: { contact: true },
  });
  console.log(`[backfill] slot=${slotId} candidates=${candidates.length}`);

  const attempts: BackfillAttempt[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const entry = candidates[index]!;
    const isLastCandidate = index === candidates.length - 1;

    await prisma.waitlistEntry.update({ where: { id: entry.id }, data: { status: "OFFERED" } });

    const { task, resultSchema } = buildBackfillTask({
      businessName: slot.business.name,
      timezone: slot.business.timezone,
      contactName: entry.contact.name,
      openSlot: slot,
    });

    const call = await runCall({
      flow: "BACKFILL",
      businessId: slot.businessId,
      phone: entry.contact.phone,
      task,
      resultSchema,
      waitlistEntryId: entry.id,
      dryRunResult: isLastCandidate
        ? { accepted: "yes", reason: "" }
        : { accepted: "no", reason: "Not available at that time." },
      idempotencyKey: `backfill_${slotId}_${entry.id}`,
    });

    const accepted =
      (call.status === "completed" || call.status === "dry_run") &&
      String(call.structuredResult?.["accepted"] ?? "no") === "yes";

    if (accepted) {
      const { appointmentId } = await bookContactIntoSlot({
        businessId: slot.businessId,
        contactId: entry.contactId,
        slotId: slot.id,
      });
      await prisma.waitlistEntry.update({ where: { id: entry.id }, data: { status: "BOOKED" } });
      attempts.push({ waitlistEntryId: entry.id, contactName: entry.contact.name, callLogId: call.callLogId, accepted: true });
      console.log(`[backfill] slot=${slotId} filled by ${entry.contact.name}`);
      return { slotId, attempts, filled: true, bookedAppointmentId: appointmentId };
    }

    await prisma.waitlistEntry.update({ where: { id: entry.id }, data: { status: "DECLINED" } });
    attempts.push({ waitlistEntryId: entry.id, contactName: entry.contact.name, callLogId: call.callLogId, accepted: false });
  }

  console.log(`[backfill] slot=${slotId} waterfall exhausted, slot remains open`);
  return { slotId, attempts, filled: false, bookedAppointmentId: null };
}
