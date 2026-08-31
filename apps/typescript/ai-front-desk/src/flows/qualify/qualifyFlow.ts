import { runCall } from "../../calle/client.js";
import { assessEvidence } from "../../calle/evidence.js";
import { prisma } from "../../db/client.js";
import { bookContactIntoSlot, findNextOpenSlot, SlotUnavailableError } from "../../services/booking.service.js";
import { buildQualifyTask } from "./prompt.js";

export interface QualifyOutcome {
  leadId: string;
  callLogId: string | null;
  result: "booked" | "waitlisted" | "not_qualified" | "no_answer" | "failed" | "already_in_progress";
  reason?: string | undefined;
}

export async function qualifyOne(leadId: string): Promise<QualifyOutcome> {
  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    include: { contact: true, business: true },
  });
  if (lead.contact === null) {
    throw new Error(`Lead ${leadId} has no contact to call.`);
  }

  // Atomic claim: only one caller can move this lead out of NEW. A retry or
  // double-click that lands here while a call is already in flight (or
  // already resolved) is a no-op instead of placing a second call.
  const claimed = await prisma.lead.updateMany({
    where: { id: leadId, status: "NEW" },
    data: { status: "CALLING" },
  });
  if (claimed.count === 0) {
    return { leadId, callLogId: null, result: "already_in_progress" };
  }

  const nextOpenSlot = await findNextOpenSlot(lead.businessId);

  const { task, resultSchema } = buildQualifyTask({
    businessName: lead.business.name,
    timezone: lead.business.timezone,
    contactName: lead.contact.name,
    rawInquiry: lead.rawInquiry,
    nextOpenSlot,
  });

  const call = await runCall({
    flow: "QUALIFY",
    businessId: lead.businessId,
    phone: lead.contact.phone,
    task,
    resultSchema,
    leadId,
    dryRunResult: {
      interested: "yes",
      reason_for_visit: "Routine check-up",
      preferred_timeframe: "This week if possible",
      wants_offered_slot: nextOpenSlot === null ? "unknown" : "yes",
    },
    idempotencyKey: `qualify:${leadId}`,
  });

  const evidence = assessEvidence(call, resultSchema);
  if (!evidence.trusted) {
    await prisma.lead.update({ where: { id: leadId }, data: { status: "FAILED" } });
    return { leadId, callLogId: call.callLogId, result: "failed", reason: evidence.reason };
  }

  const parsed = call.structuredResult ?? {};
  const interested = String(parsed["interested"] ?? "unknown");
  const wantsSlot = String(parsed["wants_offered_slot"] ?? "unknown");
  const enrichment = {
    reasonForVisit: String(parsed["reason_for_visit"] ?? "") || null,
    preferredTimeframe: String(parsed["preferred_timeframe"] ?? "") || null,
  };

  if (interested === "no") {
    await prisma.lead.update({ where: { id: leadId }, data: { ...enrichment, status: "NOT_QUALIFIED" } });
    return { leadId, callLogId: call.callLogId, result: "not_qualified" };
  }
  if (interested === "unknown") {
    await prisma.lead.update({ where: { id: leadId }, data: { ...enrichment, status: "NEW" } });
    return { leadId, callLogId: call.callLogId, result: "no_answer" };
  }

  if (nextOpenSlot !== null && wantsSlot === "yes") {
    try {
      await bookContactIntoSlot({ businessId: lead.businessId, contactId: lead.contact.id, slotId: nextOpenSlot.id });
      await prisma.lead.update({ where: { id: leadId }, data: { ...enrichment, status: "BOOKED" } });
      return { leadId, callLogId: call.callLogId, result: "booked" };
    } catch (error) {
      if (!(error instanceof SlotUnavailableError)) {
        throw error;
      }
      // Someone else took the slot between our lookup and the booking attempt; fall through to waitlist.
    }
  }

  const lowestPriority = await prisma.waitlistEntry.aggregate({
    where: { businessId: lead.businessId },
    _max: { priority: true },
  });
  await prisma.waitlistEntry.create({
    data: {
      businessId: lead.businessId,
      contactId: lead.contact.id,
      desiredServiceType: nextOpenSlot?.serviceType ?? "General",
      priority: (lowestPriority._max.priority ?? 0) + 1,
      status: "WAITING",
    },
  });
  await prisma.lead.update({ where: { id: leadId }, data: { ...enrichment, status: "WAITLISTED" } });
  return { leadId, callLogId: call.callLogId, result: "waitlisted" };
}
