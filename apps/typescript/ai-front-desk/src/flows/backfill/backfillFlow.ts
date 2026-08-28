import { runCall } from "../../calle/client.js";
import { assessEvidence } from "../../calle/evidence.js";
import { prisma } from "../../db/client.js";
import { bookContactIntoSlot, SlotUnavailableError } from "../../services/booking.service.js";
import { buildBackfillTask } from "./prompt.js";

export interface BackfillAttempt {
  waitlistEntryId: string;
  contactName: string;
  callLogId: string | null;
  accepted: boolean;
  reason?: string | undefined;
}

export interface BackfillOutcome {
  slotId: string;
  attempts: BackfillAttempt[];
  filled: boolean;
  bookedAppointmentId: string | null;
  /** Set when the waterfall stopped early because a result was untrusted/ambiguous rather than a genuine decline. The slot stays open and the halted entry is left NEEDS_REVIEW instead of DECLINED. */
  haltedReason?: string | undefined;
}

/**
 * Priority call waterfall: call WAITING waitlist entries for the slot's service
 * type in priority order until one accepts. In dry-run mode every candidate
 * declines except the last, so the full waterfall is exercised offline.
 *
 * An untrusted or ambiguous call result is NOT treated as a decline: it halts
 * the waterfall entirely (NEEDS_REVIEW) rather than moving on to the next
 * candidate, so a slot can never end up promised to two people because the
 * first candidate's real answer was unclear.
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

    // Atomic claim: only one caller can move this entry out of WAITING. A
    // retry or overlapping backfill run that lands here while an offer is
    // already in flight (or resolved) is a no-op instead of a second call.
    const claimed = await prisma.waitlistEntry.updateMany({
      where: { id: entry.id, status: "WAITING" },
      data: { status: "OFFERED" },
    });
    if (claimed.count === 0) {
      continue;
    }

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

    const evidence = assessEvidence(call, resultSchema);
    if (!evidence.trusted) {
      await prisma.waitlistEntry.update({ where: { id: entry.id }, data: { status: "NEEDS_REVIEW" } });
      attempts.push({
        waitlistEntryId: entry.id,
        contactName: entry.contact.name,
        callLogId: call.callLogId,
        accepted: false,
        reason: evidence.reason,
      });
      console.log(`[backfill] slot=${slotId} halted: ${evidence.reason}`);
      return { slotId, attempts, filled: false, bookedAppointmentId: null, haltedReason: evidence.reason };
    }

    const accepted = String(call.structuredResult?.["accepted"] ?? "no") === "yes";

    if (accepted) {
      let appointmentId: string;
      try {
        ({ appointmentId } = await bookContactIntoSlot({
          businessId: slot.businessId,
          contactId: entry.contactId,
          slotId: slot.id,
        }));
      } catch (error) {
        if (!(error instanceof SlotUnavailableError)) {
          throw error;
        }
        // The slot was taken out from under us (e.g. by a reschedule) between
        // the call completing and the booking attempt. Halt for review rather
        // than silently dropping this candidate's acceptance.
        await prisma.waitlistEntry.update({ where: { id: entry.id }, data: { status: "NEEDS_REVIEW" } });
        attempts.push({
          waitlistEntryId: entry.id,
          contactName: entry.contact.name,
          callLogId: call.callLogId,
          accepted: true,
          reason: error.message,
        });
        return { slotId, attempts, filled: false, bookedAppointmentId: null, haltedReason: error.message };
      }
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
