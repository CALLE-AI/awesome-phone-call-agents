export type CareCallRoutineKind = "medication" | "meal";

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

export type CareCallOutcome =
  | CareCallMedicationOutcome
  | CareCallMealOutcome
  | "no_answer"
  | "failed"
  | "timed_out"
  | "uncertain";

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
}
