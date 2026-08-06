export type CareCallRoutineKind = "medication" | "meal" | "hydration" | "wellbeing" | "appointment";

export type CareCallMedicationOutcome =
  | "self_reported_taken"
  | "will_take_as_instructed"
  | "unsure_if_taken"
  | "cannot_find_medication"
  | "declined"
  | "requests_help"
  | "feels_unwell";

export type CareCallMealOutcome =
  | "self_reported_ate"
  | "will_eat"
  | "no_food_available"
  | "cannot_prepare_food"
  | "meal_delivery_missing"
  | "not_feeling_well"
  | "declined"
  | "requests_help";

export type CareCallHydrationOutcome =
  | "self_reported_drank"
  | "will_drink"
  | "unsure_if_drank"
  | "no_drink_available"
  | "declined"
  | "requests_help"
  | "not_feeling_well";

/**
 * A wellbeing check-in records what the senior chose to say about themselves.
 * CareCall does not assess mood, screen for depression, or infer a condition
 * the senior did not state, so every option here is either a plain self-report
 * or a request to involve a human.
 */
export type CareCallWellbeingOutcome =
  | "self_reported_well"
  | "reports_feeling_low"
  | "wants_company"
  | "not_feeling_well"
  | "declined"
  | "requests_help";

export type CareCallAppointmentOutcome =
  | "appointment_acknowledged"
  | "will_attend"
  | "needs_transport"
  | "cannot_attend"
  | "unsure_of_appointment"
  | "declined"
  | "requests_help";

export type CareCallOutcome =
  | CareCallMedicationOutcome
  | CareCallMealOutcome
  | CareCallHydrationOutcome
  | CareCallWellbeingOutcome
  | CareCallAppointmentOutcome
  | "no_answer"
  | "failed"
  | "timed_out"
  | "uncertain";

export type CareCallUrgency = "none" | "contact-now" | "follow-up-today" | "review";

export type CareCallSafetyFlag =
  | "possible_immediate_danger"
  | "possible_medication_advice"
  | "possible_sensitive_data_request"
  | "possible_unconfirmed_dispatch_claim";

export interface CareCallRequest {
  workflow: "carecall";
  request_key: string;
  organisation: {
    name: string;
    timezone: "Asia/Singapore";
  };
  senior: {
    id: string;
    preferred_name: string;
    phone_e164: string;
    language: "English";
    authority_confirmed: boolean;
    permitted_call_window: string;
  };
  routine: {
    id: string;
    kind: CareCallRoutineKind;
    title: string;
    caregiver_instruction: string;
    caregiver_name: string;
    trust_phrase: string;
  };
  authorization: {
    exactly_one_call: true;
    authorized_at: string;
  };
}

export interface CareCallResult {
  outcome: CareCallOutcome;
  outcome_label: string;
  self_reported: boolean;
  follow_up_required: boolean;
  next_action: string;
  evidence: string | null;
  call_id: string;
  provider_status: string;
  urgency: CareCallUrgency;
  safety_flags: CareCallSafetyFlag[];
}
