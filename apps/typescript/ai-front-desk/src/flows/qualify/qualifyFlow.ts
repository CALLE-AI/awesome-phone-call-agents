import { runCall } from "../../calle/client.js";
import { prisma } from "../../db/client.js";
import { bookContactIntoSlot, findNextOpenSlot } from "../../services/booking.service.js";
import { buildQualifyTask } from "./prompt.js";

export interface QualifyOutcome {
  leadId: string;
  callLogId: string;
  result: "booked" | "waitlisted" | "not_qualified" | "no_answer" | "failed";
}

export async function qualifyOne(leadId: string): Promise<QualifyOutcome> {
  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    include: { contact: true, business: true },
  });
  if (lead.contact === null) {
    throw new Error(`Lead ${leadId} has no contact to call.`);
  }

  const nextOpenSlot = await findNextOpenSlot(lead.businessId);
  await prisma.lead.update({ where: { id: leadId }, data: { status: "CALLING" } });

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
    idempotencyKey: `qualify_${leadId}_${Date.now()}`,
  });

  if (call.status !== "completed" && call.status !== "dry_run") {
    await prisma.lead.update({ where: { id: leadId }, data: { status: "FAILED" } });
    return { leadId, callLogId: call.callLogId, result: "failed" };
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
    await bookContactIntoSlot({ businessId: lead.businessId, contactId: lead.contact.id, slotId: nextOpenSlot.id });
    await prisma.lead.update({ where: { id: leadId }, data: { ...enrichment, status: "BOOKED" } });
    return { leadId, callLogId: call.callLogId, result: "booked" };
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
