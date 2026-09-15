// src/call2-coverage-verify.ts
// CALL-E task builder for Call 2: Provisional Intake Notification.
// Notifies the claimant their claim is received and an adjuster will follow up.
// This is NOT guaranteed follow-up and NOT coverage verification.
// Does NOT collect policy or coverage data — CALL-E safety policy prohibits that.
// Depends on loss_report step result via ChainContext.

import { createHash } from "node:crypto";
import type { CallStep, ChainContext } from "./ClaimChain.js";
import type { LossReportResult } from "./types.js";

// Generate stable idempotency key from phone + execution context
function generateIdempotencyKey(phone: string, stepId: string): string {
  const input = `${phone}:${stepId}:coverage_verify`;
  return createHash("sha256").update(input).digest("hex");
}

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
        lossResult?.incident_description || "a recently reported incident";

      // Idempotency key: stable hash of phone + step id for deduplication
      // Passed in task context for provider-side deduplication
      const idempotencyKey = generateIdempotencyKey(ctx.phone, "coverage_verify");
      const taskNote = `[IDEMPOTENCY_KEY: ${idempotencyKey}]\n\n`;

      return taskNote + `You are calling on behalf of an insurance company to provide a provisional intake notification to a claimant.

IMPORTANT DISCLAIMER:
This is a notification call only. It does NOT guarantee coverage verification, adjuster assignment, or claim approval. The claimant may need to take additional steps. Cancellation or non-follow-up is possible.

DISCLOSURE (say this first, exactly):
"Hello, this is an automated assistant calling on behalf of your insurance provider. This call may be recorded for quality and compliance purposes."

Your purpose is to deliver the following update:
"We are calling to let you know that your claim regarding ${incidentSummary} has been received. A claims adjuster will attempt to contact you within 2 to 3 business days to discuss next steps. Please note that this is a provisional notification and circumstances may change."

Then ask:
"Do you have any questions I can pass along to your adjuster?"

If they ask questions you cannot answer, say:
"I will pass that along to your adjuster. They will be able to answer that when they contact you."

HARD RULES:
- Do NOT ask the claimant to confirm any policy number, account number, or coverage details
- Do NOT ask about prior claims history
- Do NOT discuss claim approval, denial, settlement amounts, or coverage verification
- Do NOT collect any personal or financial information
- Do NOT promise guaranteed follow-up or coverage approval
- Do NOT guarantee an adjuster will actually call them
- This is a notification call only — deliver the update and capture any questions
- If voicemail: leave a brief message saying the claim was received and an adjuster may call within 2-3 business days, then end the call`.trim();
    },
  };
}
