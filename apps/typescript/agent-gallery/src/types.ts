export type AppointmentStatus = "missed" | "unconfirmed";

export type Outcome =
  | "confirmed"
  | "rescheduled"
  | "no_agreement"
  | "declined"
  | "unreachable"
  | "failed"
  | "timed_out"
  | "uncertain";

export interface ReplacementWindow {
  start: string;
  end: string;
}

export interface RecoveryRequest {
  request_key: string;
  business: {
    name: string;
    timezone: string;
    callback_number_e164: string;
  };
  customer: {
    given_name: string;
    phone_e164: string;
    consent_confirmed: boolean;
  };
  appointment: {
    service: string;
    original_time: string;
    status: AppointmentStatus;
  };
  replacement_windows: ReplacementWindow[];
}

export interface RecoveryResult {
  outcome: Outcome;
  confirmed_time: string | null;
  customer_intent: string;
  follow_up_required: boolean;
  next_action: string;
  notes: string;
  call_id: string;
}

export const NEXT_ACTIONS: Record<Outcome, string> = {
  confirmed: "Mark the appointment confirmed and send an SMS confirmation.",
  rescheduled: "Book the agreed slot and send an SMS confirmation.",
  no_agreement:
    "The customer wants to rebook but no approved window worked. Decide whether to " +
    "open a new window, then have the front desk call back.",
  declined: "Free the slot. Do not call again without fresh consent.",
  unreachable: "You may retry manually later. Nothing happens automatically.",
  failed: "The call did not complete. Have the front desk call manually.",
  timed_out: "Review the transcript, then have the front desk follow up.",
  uncertain: "A person must review the transcript before any action is taken.",
};
