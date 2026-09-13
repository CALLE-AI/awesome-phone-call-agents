#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { loadLeadRequest, validateLeadRequest, maskPhone } from "./validate-lead-input.mjs";

function fillGoal(request) {
  const questions = request.qualification_questions
    .map((question, index) => `${index + 1}. ${question}`)
    .join("\n");
  const context = request.lead_context
    ? request.lead_context
    : "no extra context on file";
  const disqualify = Array.isArray(request.disqualify_on) && request.disqualify_on.length > 0
    ? request.disqualify_on.join("; ")
    : "none configured";

  return [
    `You are an AI phone assistant calling on behalf of ${request.company_name}. Disclose that immediately, say this is a short follow-up about ${request.product_label}, and name ${request.caller_name} as the person who authorized the call.`,
    "",
    "Purpose: a brief qualification conversation. Do not sell, negotiate, quote prices, or book a meeting. If the configured CALL-E workflow records or transcribes calls, disclose that before the first question and say the notes go only to " + request.caller_name + " for review.",
    "",
    `Lead context already on file: ${context}`,
    "",
    "Ask, in this order, and stop after the qualification questions are answered:",
    `1. Confirm the lead is the right person for ${request.product_label}, or who owns it.`,
    ...request.qualification_questions.map((question, index) => `${index + 2}. ${question}`),
    "",
    "Qualification rules:",
    "- Ask at most one budget question, framed as a range the lead can decline.",
    "- If the lead says now is a bad time, offer the approved follow-up channels instead of rescheduling on the call.",
    `- If any of the following come up, thank the lead, stop qualifying, and record the reason: ${disqualify}.`,
    `- If the lead asks something you cannot answer, say ${request.caller_name} will follow up through an approved channel.`,
    "- If the lead declines, asks to stop, or shows confusion about the caller's identity, thank them and end the call.",
    "",
    request.voicemail_allowed
      ? `If voicemail answers, leave this approved message: "${request.voicemail_message}"`
      : "If voicemail answers, hang up without leaving a message.",
    "",
    "Return a structured result with disposition, interest_level, needs_summary, timeline, budget_range, decision_authority, qualification_answers, preferred_followup_channel, consent_to_followup, disqualification_reason, voicemail_left, needs_human_review, and evidence. Quote the lead's own words as evidence. Do not infer interest, budget, or consent from silence."
  ].join("\n");
}

function redactedPlanCommand(request) {
  return `calle call plan --to-phone ${maskPhone(request.to_phone_e164)} --goal "<reviewed goal text, ${fillGoal(request).length} chars>" --timezone ${request.timezone} --language ${request.language || "English"} --region ${request.region || "US"}`;
}

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: node preview-lead-call.mjs <path-to-request.json>");
    process.exit(2);
  }

  const request = loadLeadRequest(path);
  const errors = validateLeadRequest(request);
  if (errors.length > 0) {
    console.log("Fix these before previewing:");
    for (const error of errors) {
      console.log(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("DRY-RUN PREVIEW - no call was placed and CALL-E was not contacted");
  console.log("");
  console.log(`lead:          ${request.lead_name} (${maskPhone(request.to_phone_e164)})`);
  console.log(`request_id:    ${request.request_id}`);
  console.log(`caller:        ${request.caller_name} at ${request.company_name}`);
  console.log(`authorization: ${request.authorized_contact_reason}`);
  console.log("");
  console.log("--- CALL-E --goal body ---");
  console.log(fillGoal(request));
  console.log("");
  console.log("--- redacted planning command (for reference only) ---");
  console.log(redactedPlanCommand(request));
  console.log("");
  console.log("--- structured result schema ---");
  console.log(JSON.stringify({
    disposition: "qualified | disqualified | no_answer | voicemail | wrong_number | declined | needs_human_review",
    request_id: request.request_id,
    lead_name: request.lead_name,
    interest_level: "high | medium | low | unknown",
    needs_summary: "string",
    timeline: "string",
    budget_range: "string or null",
    decision_authority: "owner | influencer | unknown",
    qualification_answers: [{ question: "string", answer: "string", evidence: "string" }],
    preferred_followup_channel: "phone | sms | email | none | unknown",
    consent_to_followup: false,
    disqualification_reason: null,
    voicemail_left: false,
    needs_human_review: true,
    evidence: [{ claim: "string", transcript_span: "string" }],
    do_not_rely_on: ["string"],
    notes: "string"
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
