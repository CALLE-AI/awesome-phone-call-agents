// src/call1-loss-report.ts
// CALL-E task builder for Call 1: Loss Report.

import { createHash } from "node:crypto";
import type { CallStep, ChainContext } from "./ClaimChain.js";

// Generate stable idempotency key from phone + execution context
function generateIdempotencyKey(phone: string, stepId: string): string {
  const input = `${phone}:${stepId}:loss_report`;
  return createHash("sha256").update(input).digest("hex");
}

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
    "incident_location",
    "injuries_or_safety_concerns",
    "property_damaged",
    "damage_description",
    "cause_of_incident",
    "witnesses",
    "official_report_filed",
    "official_report_number",
    "photos_or_videos_taken",
    "steps_to_prevent_further_damage",
    "emergency_services_performed",
    "existing_estimates_or_invoices",
    "other_parties_involved",
    "additional_information",
  ],
  properties: {
    outcome: {
      type: "string",
      enum: ["completed", "voicemail", "no_answer", "refused", "unclear"],
      description: "How the call ended.",
    },
    incident_description: {
      type: "string",
      description: "Claimant's own words describing what happened. Empty string if declined.",
    },
    incident_date: {
      type: "string",
      description: "ISO 8601 date and approximate time of the incident. Empty string if not provided.",
    },
    estimated_damage: {
      type: "string",
      description: "Dollar value as a string, e.g. '4200'. Empty string if declined or unclear.",
    },
    policy_number_confirmed: {
      type: "string",
      description: "Policy number as spoken by claimant, read back to confirm. Empty string if not provided.",
    },
    incident_location: {
      type: "string",
      description: "Where the incident occurred — address, intersection, or description. Empty string if not provided.",
    },
    injuries_or_safety_concerns: {
      type: "string",
      description: "Any injuries or immediate safety concerns the claimant described. Empty string if none.",
    },
    property_damaged: {
      type: "string",
      description: "What property, vehicle, or items were damaged. Empty string if not provided.",
    },
    damage_description: {
      type: "string",
      description: "Claimant's detailed description of the damage. Empty string if not provided.",
    },
    cause_of_incident: {
      type: "string",
      description: "What the claimant believes caused the incident. Empty string if unknown or not provided.",
    },
    witnesses: {
      type: "string",
      description: "Witness names and contact information if provided. Empty string if none or declined.",
    },
    official_report_filed: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description: "Whether a police, fire, or other official report was made.",
    },
    official_report_number: {
      type: "string",
      description: "Report number if a report was filed and the claimant has it. Empty string otherwise.",
    },
    photos_or_videos_taken: {
      type: "string",
      enum: ["yes", "no", "unknown"],
      description: "Whether the claimant took photos or videos of the incident or damage.",
    },
    steps_to_prevent_further_damage: {
      type: "string",
      description: "Any steps the claimant has already taken to prevent further damage. Empty string if none.",
    },
    emergency_services_performed: {
      type: "string",
      description: "Any repair, cleanup, towing, or emergency service already performed. Empty string if none.",
    },
    existing_estimates_or_invoices: {
      type: "string",
      description: "Whether the claimant has estimates, invoices, or documentation. Empty string if none.",
    },
    other_parties_involved: {
      type: "string",
      description: "Any other person, vehicle, property, or organization involved. Empty string if none.",
    },
    additional_information: {
      type: "string",
      description: "Any other information the claimant volunteered as important. Empty string if none.",
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
    taskText: (ctx: ChainContext): string => {
      const idempotencyKey = generateIdempotencyKey(ctx.phone, "loss_report");
      const taskNote = `[IDEMPOTENCY_KEY: ${idempotencyKey}]\n\n`;

      return taskNote + `You are calling on behalf of an insurance company to record a new claim.

DISCLOSURE (say this first, exactly):
"Hello, this is an automated assistant calling on behalf of your insurance provider.
This call may be recorded for quality and compliance purposes."

Collect the following information in order. Ask each question clearly and wait for the answer before moving on. If the person declines or doesn't know, note their response and continue — do not press them.

1. "Can you briefly describe what happened?"
2. "When did this occur — what date and approximately what time?"
3. "Where did the incident occur?"
4. "Was anyone injured, or was there any immediate safety concern?"
5. "What property, vehicle, or other items were damaged?"
6. "Can you describe the damage in a little more detail?"
7. "Do you know what caused the incident?"
8. "Were there any witnesses? If so, do you have their contact information?"
9. "Was a police, fire, or other official report made? If so, do you have the report number?"
10. "Did you take any photos or videos of the incident or damage?"
11. "Have you taken any steps to prevent further damage?"
12. "Has any repair, cleanup, towing, or emergency service already been performed?"
13. "Have you received any estimates, invoices, or other documentation related to the damage?"
14. "Was any other person, vehicle, property, or organization involved?"
15. "What is your rough estimate of the total damage or loss in dollars?"
16. "Can you read me your policy number?"
17. "Do you have any additional information you think would be important for us to know?"

HARD RULES:
- Never ask for SSN, payment info, medical diagnoses, or passwords
- If the person declines any field, record their response and move on — do not press them
- If voicemail: stop immediately, do not leave a message, set outcome to "voicemail"
- If a dollar amount is unclear: set estimated_damage to empty string
- Read the policy number back to confirm it before ending the call
- Do not ask for or record any information beyond the questions above`.trim();
    },
  };
}
