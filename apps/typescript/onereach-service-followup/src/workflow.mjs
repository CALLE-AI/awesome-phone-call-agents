export const outcomes = ["confirmed", "reschedule_requested", "cancelled", "question", "unreachable", "wrong_number", "opt_out", "needs_human"];

export function appointmentFixture(now = new Date()) {
  const day = new Date(now.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
  return {
    id: "SYNTHETIC-APPOINTMENT-001", customer: "Alex Demo", service: "equipment service",
    scheduledAt: `${day}T10:00:00+08:00`, timezone: "Asia/Kuala_Lumpur",
    location: "Demo service centre", alternateSlots: [`${day}T14:00:00+08:00`, `${day}T16:00:00+08:00`],
  };
}

export function createInput({ appointment, phone, region = "MY", locale = "en-MY", demoId, webhookUrl }) {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(demoId ?? "")) throw new Error("Provide a stable CALLE_DEMO_ID (8–80 letters, digits, underscores or hyphens).");
  if (!/^\+[1-9][0-9]{7,14}$/.test(phone ?? "")) throw new Error("Provide an authorized ASCII E.164 number.");
  if (webhookUrl && new URL(webhookUrl).protocol !== "https:") throw new Error("Webhook URL must use HTTPS.");
  return {
    task: [
      "You are OneReach Demo Service, an AI-assisted caller in an authorized synthetic demonstration.",
      "State that this is a demonstration, confirm the intended recipient and ask if now is a good time.",
      `Discuss only this fictional appointment: ${JSON.stringify(appointment)}.`,
      "Ask whether the appointment works. On a change request, offer only the supplied alternateSlots.",
      "Read back their chosen slot and explain that Operations must complete the change; do not claim a calendar was updated.",
      "Stop immediately on opt-out or wrong number. Route questions or unclear answers to a human.",
      "Do not collect payment details, give medical advice, invent availability, or make another attempt after refusal.",
      "Aim to finish within three minutes. This instruction is a conversational target, not a provider-enforced time limit.",
    ].join("\n"),
    recipients: [{ phones: [phone], region, locale }],
    resultSchema: { type: "object", additionalProperties: false, required: ["processed_count"], properties: { processed_count: { type: "integer" } } },
    recipientResultSchema: {
      type: "object", additionalProperties: false, required: ["outcome", "requested_slot", "needs_human"],
      properties: {
        outcome: { type: "string", enum: outcomes },
        requested_slot: { type: ["string", "null"] },
        needs_human: { type: "boolean" },
      },
    },
    metadata: { demo_id: demoId, appointment_id: appointment.id, synthetic: true, integration: "onereach-service-example" },
    ...(webhookUrl ? { webhookUrl } : {}),
  };
}

export function normalizeOutcome(call, appointment) {
  if (!call || !["completed", "failed", "canceled"].includes(call.status)) {
    return { state: "pending", nextAction: "Continue monitoring this task; do not create a replacement." };
  }
  const human = (reason) => ({ state: "complete", outcome: "needs_human", queue: "Operations", needsHuman: true, nextAction: reason, calendarUpdated: false });
  if (call.status !== "completed") return human(`CALL-E task ${call.status}; inspect before deciding whether to retry.`);
  if (call.recipients?.length !== 1) return human("Unexpected recipient count; review provider evidence.");
  const result = call.recipients[0].structuredResult;
  if (!result || !outcomes.includes(result.outcome) || typeof result.needs_human !== "boolean" ||
      !(result.requested_slot === null || typeof result.requested_slot === "string") ||
      Object.keys(result).some((key) => !["outcome", "requested_slot", "needs_human"].includes(key))) {
    return human("Missing or invalid structured result; review the conversation.");
  }
  if (result.outcome === "opt_out" || result.outcome === "wrong_number") {
    return { state: "complete", outcome: result.outcome, queue: "Operations", needsHuman: true,
      suppressFurtherContact: true, nextAction: "Stop contact; have the operator update the contact record.", calendarUpdated: false };
  }
  if (result.outcome === "reschedule_requested" && !appointment.alternateSlots.includes(result.requested_slot)) {
    return human("Requested time is not an approved alternate slot. No booking change was made.");
  }
  if (result.outcome !== "reschedule_requested" && result.requested_slot !== null) {
    return human("Outcome and requested slot conflict. No booking change was made.");
  }
  return {
    state: "complete", outcome: result.outcome, queue: "Operations",
    requestedSlot: result.requested_slot, needsHuman: result.needs_human || result.outcome !== "confirmed",
    calendarUpdated: false,
    nextAction: result.outcome === "reschedule_requested"
      ? "Operations: confirm availability and complete the requested calendar change."
      : result.outcome === "confirmed" && !result.needs_human
        ? "Appointment confirmation recorded; no calendar change required."
        : "Operations: review the conversation and resolve the next action.",
  };
}

export function syntheticCall(appointment) {
  return { id: "synthetic-call-not-provider-evidence", status: "completed", recipients: [{
    structuredResult: { outcome: "reschedule_requested", requested_slot: appointment.alternateSlots[0], needs_human: true }, attempts: [],
  }] };
}
