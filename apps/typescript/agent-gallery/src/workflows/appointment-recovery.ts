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
