import { classifyDelivery, type CalleRunResult } from "../../calle";
import { detectCareCallSafetyFlags } from "./safety";
import type { CareCallOutcome, CareCallRequest, CareCallResult, CareCallRoutineKind, CareCallSafetyFlag, CareCallUrgency } from "./types";

/**
 * Each routine kind may only produce outcomes from its own vocabulary. The map
 * is keyed by kind rather than branched, so adding a kind without giving it a
 * vocabulary is a type error instead of silently inheriting another kind's
 * outcomes and reporting a result the call never established.
 */
const OUTCOMES_BY_KIND: Record<CareCallRoutineKind, CareCallOutcome[]> = {
  medication: [
    "self_reported_taken", "will_take_as_instructed", "unsure_if_taken", "cannot_find_medication",
    "declined", "requests_help", "feels_unwell", "uncertain",
  ],
  meal: [
    "self_reported_ate", "will_eat", "no_food_available", "cannot_prepare_food", "meal_delivery_missing",
    "not_feeling_well", "declined", "requests_help", "uncertain",
  ],
  hydration: [
    "self_reported_drank", "will_drink", "unsure_if_drank", "no_drink_available",
    "not_feeling_well", "declined", "requests_help", "uncertain",
  ],
  wellbeing: [
    "self_reported_well", "reports_feeling_low", "wants_company",
    "not_feeling_well", "declined", "requests_help", "uncertain",
  ],
  appointment: [
    "appointment_acknowledged", "will_attend", "needs_transport", "cannot_attend",
    "unsure_of_appointment", "declined", "requests_help", "uncertain",
  ],
};

const permittedFor = (kind: CareCallRoutineKind): Set<CareCallOutcome> => new Set(OUTCOMES_BY_KIND[kind] ?? []);

/** Every outcome a call of this kind may report, for showing operators the limit up front. */
export function outcomesForKind(kind: CareCallRoutineKind): CareCallOutcome[] {
  return OUTCOMES_BY_KIND[kind] ?? [];
}

export function careCallOutcomeLabel(outcome: CareCallOutcome): string {
  return labels[outcome] ?? outcome.replaceAll("_", " ");
}

const labels: Record<CareCallOutcome, string> = {
  self_reported_taken: "Self-reported taken",
  will_take_as_instructed: "Will take as instructed",
  unsure_if_taken: "Unsure whether already taken",
  cannot_find_medication: "Cannot find medication",
  self_reported_ate: "Self-reported ate",
  will_eat: "Will eat shortly",
  no_food_available: "No food available",
  cannot_prepare_food: "Cannot prepare food",
  meal_delivery_missing: "Meal delivery missing",
  self_reported_drank: "Self-reported drank",
  will_drink: "Will drink shortly",
  unsure_if_drank: "Unsure whether already drank",
  no_drink_available: "No drink available",
  self_reported_well: "Self-reported feeling well",
  reports_feeling_low: "Reports feeling low",
  wants_company: "Would like company",
  appointment_acknowledged: "Appointment acknowledged",
  will_attend: "Will attend",
  needs_transport: "Needs transport",
  cannot_attend: "Cannot attend",
  unsure_of_appointment: "Unsure about the appointment",
  not_feeling_well: "Reports feeling unwell",
  declined: "Declined reminder",
  requests_help: "Requests human help",
  feels_unwell: "Reports feeling unwell",
  no_answer: "No answer",
  failed: "Call failed",
  timed_out: "Call timed out",
  uncertain: "Uncertain — human review required",
};

const OUTCOMES = Object.keys(labels) as CareCallOutcome[];

function readOutcome(result: CalleRunResult | null, kind: CareCallRequest["routine"]["kind"]): { outcome: CareCallOutcome; evidence: string | null } {
  const permitted = permittedFor(kind);
  const extracted = result?.extracted?.carecall_outcome;
  if (typeof extracted === "string" && OUTCOMES.includes(extracted as CareCallOutcome) && permitted.has(extracted as CareCallOutcome)) {
    return { outcome: extracted as CareCallOutcome, evidence: `Structured result: ${extracted}` };
  }
  // Only final summaries may carry the fallback token. A raw transcript can
  // contain a recipient repeating token-like words and is never success data.
  const text = [result?.summary, result?.post_summary].filter(Boolean).join("\n");
  const matches = [...text.matchAll(/CARECALL_OUTCOME\s*=\s*([a-z_]+)/gi)]
    .map((match) => match[1].toLowerCase() as CareCallOutcome)
    .filter((value) => OUTCOMES.includes(value) && permitted.has(value));
  const unique = [...new Set(matches)];
  if (unique.length === 1) return { outcome: unique[0], evidence: `Agent outcome token: ${unique[0]}` };
  return { outcome: "uncertain", evidence: text ? "No single valid CareCall outcome token was found." : null };
}

/** Outcomes that need nothing further: the senior reported doing it, or said they will. */
const SETTLED_OUTCOMES: CareCallOutcome[] = [
  "self_reported_taken", "self_reported_ate", "self_reported_drank", "self_reported_well",
  "will_take_as_instructed", "will_eat", "will_drink", "will_attend", "appointment_acknowledged",
];

/** What the senior stated about themselves, never what CareCall concluded. */
const SELF_REPORTED_OUTCOMES: CareCallOutcome[] = [
  "self_reported_taken", "self_reported_ate", "self_reported_drank",
  "self_reported_well", "appointment_acknowledged",
];

function urgencyFor(outcome: CareCallOutcome, flags: CareCallSafetyFlag[]): CareCallUrgency {
  if (flags.includes("possible_immediate_danger") || flags.includes("possible_unconfirmed_dispatch_claim")) return "contact-now";
  if (flags.includes("possible_medication_advice") || flags.includes("possible_sensitive_data_request")) return "review";
  // A senior who reports feeling low is escalated at the same level as one who
  // reports feeling unwell. CareCall cannot tell the difference between a
  // passing bad day and something that needs attention, so it does not try.
  if ([
    "unsure_if_taken", "feels_unwell", "not_feeling_well",
    "no_food_available", "cannot_prepare_food",
    "no_drink_available", "reports_feeling_low",
  ].includes(outcome)) return "contact-now";
  if ([
    "cannot_find_medication", "meal_delivery_missing", "requests_help", "declined",
    "unsure_if_drank", "wants_company",
    "needs_transport", "cannot_attend", "unsure_of_appointment",
  ].includes(outcome)) return "follow-up-today";
  if (["no_answer", "failed", "timed_out", "uncertain"].includes(outcome)) return "review";
  return "none";
}

function nextAction(outcome: CareCallOutcome, caregiver: string, urgency: CareCallUrgency, flags: CareCallSafetyFlag[]): string {
  if (flags.includes("possible_immediate_danger")) {
    return `Contact ${caregiver} or an authorized coordinator now. CareCall did not dispatch emergency services.`;
  }
  if (flags.length > 0) return "A coordinator should review the call for a possible safety-policy breach before relying on its outcome.";
  if (SETTLED_OUTCOMES.includes(outcome)) return "No follow-up is currently required.";
  if (outcome === "no_answer") return "Review the authorized no-answer policy before any retry.";
  if (outcome === "failed" || outcome === "timed_out") return "A coordinator should review delivery state before retrying.";
  return `${caregiver} or an authorized coordinator should ${urgency === "contact-now" ? "follow up now" : "follow up"}.`;
}

export function buildCareCallResult(input: {
  request: CareCallRequest;
  status: string;
  calle: CalleRunResult | null;
  runId: string;
}): CareCallResult {
  const delivery = classifyDelivery(input.status);
  const safetyFlags = detectCareCallSafetyFlags(input.calle);
  let outcome: CareCallOutcome;
  let evidence: string | null = null;
  if (delivery === "unreachable") outcome = "no_answer";
  else if (delivery === "failed") outcome = "failed";
  else if (delivery === "timed_out") outcome = "timed_out";
  else if (delivery !== "answered") outcome = "uncertain";
  else {
    const read = readOutcome(input.calle, input.request.routine.kind);
    outcome = read.outcome;
    evidence = read.evidence;
    const confidence = input.calle?.outcome?.completion_confidence?.score;
    if (typeof confidence === "number" && confidence < 0.6) {
      outcome = "uncertain";
      evidence = "CALL-E completion confidence was below the 0.6 review threshold.";
    }
  }
  if (safetyFlags.some((flag) => flag !== "possible_immediate_danger")) outcome = "uncertain";
  const urgency = urgencyFor(outcome, safetyFlags);
  const successfulSelfReport = SELF_REPORTED_OUTCOMES.includes(outcome);
  return {
    outcome,
    outcome_label: labels[outcome],
    self_reported: successfulSelfReport,
    follow_up_required: urgency !== "none",
    next_action: nextAction(outcome, input.request.routine.caregiver_name, urgency, safetyFlags),
    evidence,
    call_id: input.calle?.call_id ?? input.runId,
    provider_status: input.status,
    urgency,
    safety_flags: safetyFlags,
  };
}
