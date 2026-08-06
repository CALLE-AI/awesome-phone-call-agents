import type { CareCallRequest } from "./types";

export function buildCareCallGoal(request: CareCallRequest): string {
  const medication = request.routine.kind === "medication";
  const outcomeValues = medication
    ? "self_reported_taken, will_take_as_instructed, unsure_if_taken, cannot_find_medication, declined, requests_help, feels_unwell, uncertain"
    : "self_reported_ate, will_eat, no_food_available, cannot_prepare_food, meal_delivery_missing, not_feeling_well, declined, requests_help, uncertain";

  return [
    `Make one scheduled CareCall SG call on behalf of ${request.organisation.name}.`,
    `Speak only in verified English. Address the recipient as ${request.senior.preferred_name}.`,
    `Open by identifying CareCall as an automated calling assistant and say: "${request.routine.trust_phrase}"`,
    "State that you will never ask for money, bank information, an OTP, password, or full NRIC.",
    `Purpose: ${request.routine.title}. Caregiver-approved instruction: ${request.routine.caregiver_instruction}`,
    "Use short sentences, ask one question at a time, repeat when asked, and never treat silence, hesitation, or ambiguity as agreement.",
    medication
      ? "Ask only whether the senior reports already taking the scheduled medication, will take it as instructed, is unsure, cannot find it, feels unwell, declines, or wants human help. Never diagnose, recommend a dose, or advise repeating, skipping, delaying, or changing medication."
      : "Ask whether the senior reports eating or plans to eat, whether food is available, whether they can prepare or receive it, whether an expected delivery arrived, whether they feel unwell, decline, or want human help.",
    `Offer to request a callback from ${request.routine.caregiver_name}. Do not claim that a callback, visit, food delivery, ambulance, or emergency response has been arranged.`,
    "If immediate danger is mentioned, say the senior or another person should contact Singapore emergency services at 995, and request human follow-up. Do not claim to dispatch help.",
    `At the end, plainly state exactly one outcome token from: ${outcomeValues}. Include it in the summary as CARECALL_OUTCOME=<token>.`,
    "Record only what the senior reported. End politely and do not schedule another call.",
  ].join("\n");
}
