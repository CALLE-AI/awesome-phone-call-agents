import type { RecoveryRequest } from "../types";

export const MAX_REPLACEMENT_WINDOWS = 3;

export const appointmentRecovery = {
  id: "appointment-recovery",
  title: "Appointment Recovery",
  summary:
    "Call a customer after a missed or unconfirmed appointment, confirm or " +
    "reschedule it inside business-approved windows, and return a structured " +
    "disposition with a concrete next action.",
  agentMay: [
    "confirm the original appointment slot",
    "offer only the operator-entered replacement windows",
    "book exactly one offered window",
    "note a requested SMS confirmation",
    "accept a decline and end the call politely",
  ],
  agentMayNot: [
    "change prices or offer discounts",
    "discuss other customers",
    "give medical, legal, or financial advice",
    "promise anything outside the offered windows",
    "call back later on its own",
    "treat silence, hesitation, or ambiguity as agreement",
  ],
} as const;

/**
 * Build the free-text goal sent to CALL-E's `plan_call`.
 *
 * Two clauses exist because of the Phase 2 de-risking call. The planner adds
 * its own voicemail behavior when the goal is silent about it, so the policy is
 * stated explicitly. And the agent held every policy boundary but answered each
 * unavailable request with "the front desk will follow up" instead of steering
 * back, losing a recoverable booking, so restating the windows is now required.
 *
 * The closing instruction exists because CALL-E has no custom extraction
 * schema: domain facts are only recoverable if the agent says them plainly.
 */
export function buildCallGoal(request: RecoveryRequest): string {
  const windows = request.replacement_windows
    .map((window, index) => `${index + 1}. ${window.start} to ${window.end}`)
    .join("\n");

  return [
    `You are calling on behalf of ${request.business.name}.`,
    `The customer, ${request.customer.given_name}, has a ${request.appointment.status} ` +
      `appointment for ${request.appointment.service} originally at ` +
      `${request.appointment.original_time}. Offer to confirm or rebook it.`,
    `Offer ONLY these replacement windows, in ${request.business.timezone}:\n${windows}`,
    "You may confirm the original appointment, book exactly one of the windows above, " +
      "note whether the customer wants an SMS confirmation, and accept a decline politely.",
    "You may NOT offer any discount or price change, offer any time outside those windows, " +
      "discuss other customers, or give medical, legal, or financial advice.",
    "If the customer proposes a time outside those windows, say plainly that it is not " +
      "available, restate the windows above, and ask them to choose one of them or say they " +
      "would rather not rebook. Do not end the call at the first unavailable request.",
    "If the customer is unclear, hesitant, or does not commit, do not record agreement. " +
      "Say the front desk will follow up.",
    "Before ending, state plainly which window the customer accepted, or that they accepted " +
      "none, and whether they want an SMS confirmation.",
    "If nobody answers, do not leave a voicemail. End the call and report that nobody answered.",
    "Keep the call under two minutes. Be warm and brief.",
  ].join("\n\n");
}
