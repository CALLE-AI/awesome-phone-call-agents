import type { CalleRunResult } from "../../calle";
import type { CareCallSafetyFlag, CareCallUrgency } from "./types";

export interface SafetyFlagDetail {
  label: string;
  /** What raising the flag does and does not claim. */
  meaning: string;
  /** What an operator is expected to do about it. */
  response: string;
}

/**
 * Kept beside the detection patterns and typed as a complete record, so a new
 * flag cannot reach an operator as a bare identifier with no stated meaning.
 */
export const careCallSafetyFlagDetails: Record<CareCallSafetyFlag, SafetyFlagDetail> = {
  possible_immediate_danger: {
    label: "Possible immediate danger",
    meaning: "Wording associated with an urgent physical problem appeared in the call. CareCall did not diagnose anything and cannot tell who said the words.",
    response: "Contact the caregiver or an authorized coordinator now. CareCall did not dispatch emergency services. In Singapore an emergency is 995, dialled by a person.",
  },
  possible_medication_advice: {
    label: "Possible medication advice",
    meaning: "Wording resembling dosage, repeat-dose, or skip-dose advice appeared. CareCall is never permitted to give it.",
    response: "Treat the outcome as unreliable, review the call for a policy breach, and confirm the senior's actual medication position with a human.",
  },
  possible_sensitive_data_request: {
    label: "Possible sensitive-data request",
    meaning: "Wording resembling a request for an OTP, password, full NRIC, or banking details appeared. CareCall is never permitted to ask for these.",
    response: "Review the call before relying on it, and confirm with the senior that nothing was shared.",
  },
  possible_unconfirmed_dispatch_claim: {
    label: "Possible unconfirmed dispatch claim",
    meaning: "Wording suggesting help was already sent appeared. CareCall does not dispatch anyone, so such a claim would be untrue.",
    response: "Contact the senior directly. Assume no help is on the way unless a person arranged it.",
  },
};

export interface UrgencyDetail {
  label: string;
  meaning: string;
}

export const careCallUrgencyDetails: Record<CareCallUrgency, UrgencyDetail> = {
  "contact-now": {
    label: "Contact now",
    meaning: "A person should reach the senior without waiting for the next scheduled call.",
  },
  "follow-up-today": {
    label: "Follow up today",
    meaning: "A person should resolve this during the day; it is not an emergency.",
  },
  review: {
    label: "Review",
    meaning: "The call did not establish a reliable outcome. A person decides what happened before anything is retried.",
  },
  none: {
    label: "No follow-up",
    meaning: "The senior reported doing the thing, or said they would. Nothing further is implied.",
  },
};

const checks: { flag: CareCallSafetyFlag; patterns: RegExp[] }[] = [
  {
    flag: "possible_immediate_danger",
    patterns: [
      /\b(?:cannot|can't) breathe\b/i,
      /\bchest pain\b/i,
      /\b(?:collapsed|unconscious)\b/i,
      /\b(?:fell|fallen|fall)\b.{0,40}\b(?:cannot|can't) get up\b/i,
      /\bimmediate danger\b/i,
    ],
  },
  {
    flag: "possible_medication_advice",
    patterns: [
      /\b(?:take|have) (?:another|two|double) (?:dose|tablet|pill)s?\b/i,
      /\bskip (?:this|the|your) dose\b/i,
      /\bit is safe (?:for you )?to take\b/i,
      /\bchange (?:the|your) (?:dose|dosage|medication)\b/i,
    ],
  },
  {
    flag: "possible_sensitive_data_request",
    patterns: [
      /\b(?:tell|give|share|read) (?:me )?(?:your )?(?:otp|one[- ]time password|password|full nric)\b/i,
      /\bwhat is (?:your )?(?:otp|one[- ]time password|password|full nric)\b/i,
      /\b(?:bank account|banking details|credit card number)\b/i,
    ],
  },
  {
    flag: "possible_unconfirmed_dispatch_claim",
    patterns: [
      /\b(?:an ambulance|your caregiver|a caregiver|help) is (?:coming|on the way)\b/i,
      /\bwe (?:have )?(?:called|dispatched|sent) (?:an ambulance|emergency services|your caregiver|help)\b/i,
    ],
  },
];

/**
 * Call output is untrusted. These checks only raise review flags; they do not
 * determine who said the words or diagnose the senior's condition.
 */
export function detectCareCallSafetyFlags(result: CalleRunResult | null): CareCallSafetyFlag[] {
  const text = [result?.summary, result?.post_summary, result?.transcript].filter(Boolean).join("\n");
  if (!text) return [];
  return checks
    .filter((check) => check.patterns.some((pattern) => pattern.test(text)))
    .map((check) => check.flag);
}
