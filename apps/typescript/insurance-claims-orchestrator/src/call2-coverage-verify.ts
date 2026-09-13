// src/call2-coverage-verify.ts
// CALL-E task builder for Call 2: Adjuster Notification.
// Informs the claimant their claim is received and an adjuster will follow up.
// Does NOT collect policy or coverage data — CALL-E safety policy prohibits that.
// Depends on loss_report step result via ChainContext.

import type { CallStep, ChainContext } from "./ClaimChain.js";
import type { LossReportResult } from "./types.js";

// Schema captures call outcome and any claimant questions — nothing sensitive.
const adjusterNotifySchema = {
  type: "object",
  required: [
    "outcome",
    "adjuster_notified",
    "claimant_questions",
    "claimant_confirmed_receipt",
  ],
  properties: {
    outcome: {
      type: "string",
      enum: ["completed", "voicemail", "no_answer", "refused", "unclear"],
      description: "How the call ended.",
    },
    adjuster_notified: {
      type: "string",
      enum: ["yes", "no"],
      description: "Whether the claimant was told an adjuster will follow up within 2-3 business days.",
    },
    claimant_confirmed_receipt: {
      type: "string",
      enum: ["yes", "no", "unclear"],
      description: "Whether the claimant acknowledged they understood an adjuster will contact them.",
    },
    claimant_questions: {
      type: "string",
      description: "Verbatim questions the claimant asked during the call. Empty string if none.",
    },
  },
  additionalProperties: false,
};

export function buildCoverageVerifyStep(): CallStep {
  return {
    id: "coverage_verify",
    dependsOn: "loss_report",
    retryOnOutcome: [],
    maxRetries: 1,
    resultSchema: adjusterNotifySchema,
    taskText: (ctx: ChainContext): string => {
      const lossResult = ctx.results["loss_report"] as LossReportResult | undefined;
      const incidentSummary =
        lossResult?.incident_description ?? "a recently reported incident";

      return `You are calling on behalf of an insurance company to notify a claimant that their claim has been received and an adjuster will be in touch.

DISCLOSURE (say this first, exactly):
"Hello, this is an automated assistant calling on behalf of your insurance provider. This call may be recorded for quality and compliance purposes."

Your purpose is to deliver the following update:
"We are calling to let you know that your claim regarding ${incidentSummary} has been received. A claims adjuster will be in contact with you within 2 to 3 business days to discuss next steps."

Then ask:
"Do you have any questions I can pass along to your adjuster?"

If they ask questions you cannot answer, say:
"I will pass that along to your adjuster. They will be able to answer that when they contact you."

HARD RULES:
- Do NOT ask the claimant to confirm any policy number, account number, or coverage details
- Do NOT ask about prior claims history
- Do NOT discuss claim approval, denial, or settlement amounts
- Do NOT collect any personal or financial information
- This is a notification call only — deliver the update and capture any questions
- If voicemail: leave a brief message saying the claim was received and an adjuster will call within 2-3 business days, then end the call`.trim();
    },
  };
}
