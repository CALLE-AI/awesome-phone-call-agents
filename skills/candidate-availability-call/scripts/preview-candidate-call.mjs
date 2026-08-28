#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { loadCandidateRequest, maskPhone, validateCandidateRequest } from "./validate-candidate-input.mjs";

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, `'\"'\"'`)}'`;
}

function formatWindows(windows) {
  return windows.map((window, index) => `${index + 1}. ${window.start} to ${window.end}`).join("\n");
}

function buildGoal(request) {
  const channels = request.followup_channels.join(", ");
  const voicemail = request.voicemail_allowed
    ? `If voicemail answers, leave only this approved message: "${request.voicemail_message}"`
    : "If voicemail answers, do not leave a message.";
  const boundaries = Array.isArray(request.do_not_discuss) && request.do_not_discuss.length
    ? request.do_not_discuss.map((item) => `- ${item}`).join("\n")
    : "- screening\n- compensation\n- protected characteristics";

  return `You are an AI phone assistant calling on behalf of ${request.company_name}. Disclose that immediately and say that ${request.coordinator_name} authorized this one scheduling-coordination call.

Purpose: ask ${request.candidate_name} about availability for ${request.role_label}. This call is only for scheduling coordination. Do not interview, screen, discuss compensation, make employment promises, or confirm that an interview is booked.

If the configured CALL-E workflow records or transcribes calls, disclose that before asking scheduling questions and say the transcript is used only to create a scheduling note for human review.

Authorized contact reason: ${request.authorized_contact_reason}
Interview duration: ${request.interview_duration_minutes} minutes.
Timezone to use: ${request.timezone}.
Coordinator-supported windows:
${formatWindows(request.allowed_windows)}

Ask:
1. Which of these windows, if any, work for the candidate?
2. What timezone should the coordinator use?
3. Are there scheduling constraints the coordinator should know?
4. Which allowed follow-up channel does the candidate prefer: ${channels}?
5. Does the candidate consent to a follow-up through that channel about this interview scheduling request?

Do not discuss:
${boundaries}

${voicemail}

If the candidate declines, is uncertain, or asks a question outside scheduling, thank them and mark the result for human review.

Return a structured result with disposition, availability_windows, timezone_confirmed, constraints, preferred_followup_channel, consent_to_followup, voicemail_left, needs_human_review, and evidence. Do not infer availability or consent from silence.`;
}

function buildPreview(request) {
  const goal = buildGoal(request);
  const previewArgs = ["calle", "call", "plan", "--to-phone", "<E164_PHONE>", "--goal", goal];
  if (request.timezone) previewArgs.push("--timezone", request.timezone);
  if (request.language) previewArgs.push("--language", request.language);
  if (request.region) previewArgs.push("--region", request.region);

  return {
    dry_run: true,
    would_place_call: false,
    request_id: request.request_id,
    candidate_name: request.candidate_name,
    masked_to_phone: maskPhone(request.to_phone_e164),
    call_goal: goal,
    calle_cli_plan_command_preview: previewArgs.map(shellQuote).join(" "),
    sensitive_command_note: "Dry-run output intentionally redacts --to-phone. Insert the reviewed E.164 number only at live planning time after explicit user authorization.",
    disposition_options: [
      "available",
      "unavailable",
      "voicemail",
      "no_answer",
      "wrong_number",
      "declined",
      "needs_human_review"
    ],
    expected_result_schema: {
      disposition: "available | unavailable | voicemail | no_answer | wrong_number | declined | needs_human_review",
      request_id: "string",
      candidate_name: "string",
      availability_windows: [
        {
          start: "string",
          end: "string",
          timezone: "string",
          evidence: "string"
        }
      ],
      timezone_confirmed: "string",
      constraints: ["string"],
      preferred_followup_channel: "phone | sms | email | none | unknown",
      consent_to_followup: "boolean; true only when the candidate explicitly consents",
      voicemail_left: false,
      needs_human_review: true,
      evidence: [
        {
          claim: "string",
          transcript_span: "string"
        }
      ],
      do_not_rely_on: ["string"],
      notes: "string"
    }
  };
}

const args = process.argv.slice(2);
const inputPath = args[0];
const outputFlagIndex = args.indexOf("--output");
const outputPath = outputFlagIndex >= 0 ? args[outputFlagIndex + 1] : undefined;

if (!inputPath) {
  console.error("Usage: node scripts/preview-candidate-call.mjs assets/sample-candidate-request.json [--output preview.json]");
  process.exit(2);
}

const request = loadCandidateRequest(inputPath);
const validation = validateCandidateRequest(request);
if (!validation.valid) {
  console.error(JSON.stringify(validation, null, 2));
  process.exit(1);
}

const preview = buildPreview(request);
const output = JSON.stringify(preview, null, 2);
if (outputPath) {
  writeFileSync(outputPath, `${output}\n`, "utf8");
} else {
  console.log(output);
}
