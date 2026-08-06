import type { CalleRunResult } from "../../calle";
import type { CareCallSafetyFlag } from "./types";

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
