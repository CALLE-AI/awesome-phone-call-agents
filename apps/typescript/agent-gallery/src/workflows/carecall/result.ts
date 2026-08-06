import { classifyDelivery, type CalleRunResult } from "../../calle";
import type { CareCallOutcome, CareCallRequest, CareCallResult } from "./types";

const OUTCOMES: CareCallOutcome[] = [
  "self_reported_taken", "will_take_as_instructed", "unsure_if_taken", "cannot_find_medication",
  "self_reported_ate", "will_eat", "no_food_available", "cannot_prepare_food", "meal_delivery_missing",
  "not_feeling_well", "declined", "requests_help", "feels_unwell", "no_answer", "failed", "timed_out", "uncertain",
];

const MEDICATION_OUTCOMES = new Set<CareCallOutcome>([
  "self_reported_taken", "will_take_as_instructed", "unsure_if_taken", "cannot_find_medication",
  "declined", "requests_help", "feels_unwell", "uncertain",
]);

const MEAL_OUTCOMES = new Set<CareCallOutcome>([
  "self_reported_ate", "will_eat", "no_food_available", "cannot_prepare_food", "meal_delivery_missing",
  "not_feeling_well", "declined", "requests_help", "uncertain",
]);

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
  not_feeling_well: "Reports feeling unwell",
  declined: "Declined reminder",
  requests_help: "Requests human help",
  feels_unwell: "Reports feeling unwell",
  no_answer: "No answer",
  failed: "Call failed",
  timed_out: "Call timed out",
  uncertain: "Uncertain — human review required",
};

function readOutcome(result: CalleRunResult | null, kind: CareCallRequest["routine"]["kind"]): { outcome: CareCallOutcome; evidence: string | null } {
  const permitted = kind === "medication" ? MEDICATION_OUTCOMES : MEAL_OUTCOMES;
  const extracted = result?.extracted?.carecall_outcome;
  if (typeof extracted === "string" && OUTCOMES.includes(extracted as CareCallOutcome) && permitted.has(extracted as CareCallOutcome)) {
    return { outcome: extracted as CareCallOutcome, evidence: `Structured result: ${extracted}` };
  }
  const text = [result?.summary, result?.post_summary, result?.transcript].filter(Boolean).join("\n");
  const matches = [...text.matchAll(/CARECALL_OUTCOME\s*=\s*([a-z_]+)/gi)]
    .map((match) => match[1].toLowerCase() as CareCallOutcome)
    .filter((value) => OUTCOMES.includes(value) && permitted.has(value));
  const unique = [...new Set(matches)];
  if (unique.length === 1) return { outcome: unique[0], evidence: `Agent outcome token: ${unique[0]}` };
  return { outcome: "uncertain", evidence: text ? "No single valid CareCall outcome token was found." : null };
}

function nextAction(outcome: CareCallOutcome, caregiver: string): string {
  if (["self_reported_taken", "self_reported_ate", "will_take_as_instructed", "will_eat"].includes(outcome)) {
    return "No follow-up is currently required.";
  }
  if (outcome === "no_answer") return "Review the authorized no-answer policy before any retry.";
  if (outcome === "failed" || outcome === "timed_out") return "A coordinator should review delivery state before retrying.";
  return `${caregiver} or an authorized coordinator should follow up.`;
}

export function buildCareCallResult(input: {
  request: CareCallRequest;
  status: string;
  calle: CalleRunResult | null;
  runId: string;
}): CareCallResult {
  const delivery = classifyDelivery(input.status);
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
    if (typeof confidence === "number" && confidence < 0.6) outcome = "uncertain";
  }
  const successfulSelfReport = ["self_reported_taken", "self_reported_ate"].includes(outcome);
  return {
    outcome,
    outcome_label: labels[outcome],
    self_reported: successfulSelfReport,
    follow_up_required: !["self_reported_taken", "self_reported_ate", "will_take_as_instructed", "will_eat"].includes(outcome),
    next_action: nextAction(outcome, input.request.routine.caregiver_name),
    evidence,
    call_id: input.calle?.call_id ?? input.runId,
    provider_status: input.status,
  };
}
