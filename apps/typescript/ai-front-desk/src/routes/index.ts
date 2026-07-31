import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db/client.js";
import { env } from "../config/env.js";
import { runConfirmSweep, confirmOne } from "../flows/confirm/confirmFlow.js";
import { startBackfillForSlot } from "../flows/backfill/backfillFlow.js";
import { qualifyOne } from "../flows/qualify/qualifyFlow.js";
import { freeSlotFromAppointment } from "../services/booking.service.js";

export const api = Router();

api.get("/appointments", async (_request, response) => {
  const appointments = await prisma.appointment.findMany({
    include: { contact: true, slot: true },
    orderBy: { createdAt: "asc" },
  });
  response.json(appointments);
});

api.get("/slots", async (_request, response) => {
  const slots = await prisma.slot.findMany({ orderBy: { startsAt: "asc" }, include: { appointment: { include: { contact: true } } } });
  response.json(slots);
});

api.get("/waitlist", async (_request, response) => {
  const entries = await prisma.waitlistEntry.findMany({ include: { contact: true }, orderBy: { priority: "asc" } });
  response.json(entries);
});

api.get("/leads", async (_request, response) => {
  const leads = await prisma.lead.findMany({ include: { contact: true }, orderBy: { createdAt: "desc" } });
  response.json(leads);
});

api.get("/calls", async (_request, response) => {
  const calls = await prisma.callLog.findMany({ orderBy: { createdAt: "desc" } });
  response.json(calls);
});

api.get("/calls/:id", async (request, response) => {
  const call = await prisma.callLog.findUnique({ where: { id: request.params.id } });
  if (call === null) {
    response.status(404).json({ error: "not_found" });
    return;
  }
  response.json(call);
});

api.get("/status", async (_request, response) => {
  const liveCallsUsed = await prisma.callLog.count({ where: { dryRun: false } });
  response.json({ dryRun: env.CALLE_DRY_RUN, liveCallsUsed, freeTierTotal: 20 });
});

// ---- Simulate triggers -------------------------------------------------
// These call the EXACT same flow functions as the cron scheduler. The only
// demo-specific behavior is state setup (e.g. moving a slot into the
// confirmation window) before invoking the shared flow.

const confirmBody = z.object({
  appointmentId: z.string().optional(),
  mock: z.enum(["attend", "decline"]).default("attend"),
});

api.post("/simulate/confirm-nearing", async (request, response) => {
  const body = confirmBody.parse(request.body ?? {});
  let appointmentId = body.appointmentId;
  if (appointmentId === undefined) {
    const next = await prisma.appointment.findFirst({
      where: { status: "SCHEDULED", confirmationCallStatus: "NOT_CALLED", slotId: { not: null } },
      include: { slot: true },
      orderBy: { createdAt: "asc" },
    });
    if (next === null) {
      response.status(404).json({ error: "no_unconfirmed_appointment" });
      return;
    }
    appointmentId = next.id;
  }
  // Demo state setup: pull the appointment's slot into the next-24h window,
  // then run the identical sweep the cron job runs.
  const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId }, include: { slot: true } });
  if (appointment.slot !== null) {
    const inTwentyHours = new Date(Date.now() + 20 * 60 * 60 * 1000);
    const durationMs = appointment.slot.endsAt.getTime() - appointment.slot.startsAt.getTime();
    await prisma.slot.update({
      where: { id: appointment.slot.id },
      data: { startsAt: inTwentyHours, endsAt: new Date(inTwentyHours.getTime() + durationMs) },
    });
  }
  const outcome = await confirmOne(appointmentId, body.mock);
  response.json(outcome);
});

const cancelBody = z.object({ appointmentId: z.string() });

api.post("/simulate/cancellation", async (request, response) => {
  const body = cancelBody.parse(request.body ?? {});
  const freedSlotId = await freeSlotFromAppointment(body.appointmentId, "CANCELLED");
  if (freedSlotId === null) {
    response.status(400).json({ error: "appointment_had_no_slot" });
    return;
  }
  const outcome = await startBackfillForSlot(freedSlotId);
  response.json(outcome);
});

const leadBody = z.object({
  name: z.string().min(1),
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/, "phone must be E.164"),
  inquiry: z.string().min(1),
});

api.post("/simulate/new-lead", async (request, response) => {
  const body = leadBody.parse(request.body ?? {});
  const business = await prisma.business.findFirstOrThrow();
  const contact = await prisma.contact.create({
    data: { businessId: business.id, name: body.name, phone: body.phone },
  });
  const lead = await prisma.lead.create({
    data: { businessId: business.id, contactId: contact.id, rawInquiry: body.inquiry },
  });
  const outcome = await qualifyOne(lead.id);
  response.json(outcome);
});

api.post("/simulate/run-confirm-sweep", async (_request, response) => {
  const outcomes = await runConfirmSweep();
  response.json(outcomes);
});
