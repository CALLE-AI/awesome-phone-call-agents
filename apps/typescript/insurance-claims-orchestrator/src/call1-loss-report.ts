// src/call1-loss-report.ts
// CALL-E task builder for Call 1: Loss Report.

import type { CallStep } from "./ClaimChain.js";

// CALL-E only supports: type string/number/boolean/object/array, enum.
// Nullable fields use type "string" with empty string as the null sentinel.
// Null coercion happens in the app layer after the call returns.
const lossReportSchema = {
  type: "object",
  required: [
    "outcome",
    "incident_description",
    "incident_date",
    "estimated_damage",
    "policy_number_confirmed",
  ],
  properties: {
    outcome: {
      type: "string",
      enum: ["completed", "voicemail", "no_answer", "refused", "unclear"],
      description: "How the call ended.",
    },
    incident_description: {
      type: "string",
      description: "Claimant's own words describing the incident. Empty string if declined or not provided.",
    },
    incident_date: {
      type: "string",
      description: "ISO 8601 date of the incident. Empty string if not provided.",
    },
    estimated_damage: {
      type: "string",
      description: "Dollar value as a string, e.g. '4200'. Empty string if claimant declined or was unclear.",
    },
    policy_number_confirmed: {
      type: "string",
      description: "Policy number as spoken by claimant. Empty string if not provided.",
    },
  },
  additionalProperties: false,
};

export function buildLossReportStep(): CallStep {
  return {
    id: "loss_report",
    retryOnOutcome: ["no_answer"],
    maxRetries: 2,
    resultSchema: lossReportSchema,
    taskText: () =>
      `You are calling on behalf of an insurance company to record a new claim.

DISCLOSURE (say this first, exactly):
"Hello, this is an automated assistant calling on behalf of your insurance provider.
This call may be recorded for quality and compliance purposes."

Then collect in this order — do not skip ahead:
1. "Can you briefly describe what happened?"
2. "When did this occur — what date and approximately what time?"
3. "What is your rough estimate of the damage or loss in dollars?"
4. "Can you read me your policy number?"

HARD RULES:
- Never ask for SSN, payment info, medical details, or passwords
- If the person declines any field, record it as "declined" and move on
- If voicemail: stop immediately, do not leave a message, set outcome to "voicemail"
- If outcome is unclear on any monetary value: set estimated_damage to null
- Read the policy number back to confirm it before ending the call
- Do not ask for or record any information beyond the four items above`.trim(),
  };
}
