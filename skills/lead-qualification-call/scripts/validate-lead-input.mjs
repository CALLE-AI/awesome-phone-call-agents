#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REQUIRED_FIELDS = [
  "request_id",
  "lead_name",
  "to_phone_e164",
  "company_name",
  "caller_name",
  "authorized_contact_reason",
  "product_label",
  "qualification_questions",
  "timezone",
  "followup_channels"
];

const E164_RE = /^\+[1-9]\d{7,14}$/;

function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function loadLeadRequest(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function validateLeadRequest(request) {
  const errors = [];
  for (const field of REQUIRED_FIELDS) {
    if (request[field] === undefined || request[field] === null || request[field] === "") {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (request.to_phone_e164 && !E164_RE.test(String(request.to_phone_e164))) {
    errors.push("to_phone_e164 must be E.164, for example +15550101337");
  }

  if (!Array.isArray(request.qualification_questions) || request.qualification_questions.length < 2 || request.qualification_questions.length > 4) {
    errors.push("qualification_questions must contain 2 to 4 questions");
  } else {
    const budgetQuestions = request.qualification_questions.filter((q) =>
      /\b(budget|price|spend|cost|pay)\b/i.test(String(q))
    );
    if (budgetQuestions.length > 1) {
      errors.push("qualification_questions may include at most one budget question");
    }
  }

  if (!isValidTimeZone(request.timezone)) {
    errors.push("timezone must be a valid IANA timezone, for example America/New_York");
  }

  if (!Array.isArray(request.followup_channels) || request.followup_channels.length === 0) {
    errors.push("followup_channels must be a non-empty array");
  } else {
    const allowed = new Set(["phone", "sms", "email"]);
    for (const channel of request.followup_channels) {
      if (!allowed.has(channel)) {
        errors.push(`Unsupported followup channel: ${channel}`);
      }
    }
  }

  if (request.voicemail_allowed && !request.voicemail_message) {
    errors.push("voicemail_message is required when voicemail_allowed is true");
  }

  if (typeof request.authorized_contact_reason === "string" && request.authorized_contact_reason.trim().length < 20) {
    errors.push("authorized_contact_reason must explain where the lead opted in (at least 20 characters)");
  }

  return errors;
}

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: node validate-lead-input.mjs <path-to-request.json>");
    process.exit(2);
  }

  let request;
  try {
    request = loadLeadRequest(path);
  } catch (error) {
    console.error(`Could not read request file: ${error.message}`);
    process.exit(2);
  }

  const errors = validateLeadRequest(request);
  if (errors.length > 0) {
    console.log("INVALID");
    for (const error of errors) {
      console.log(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("VALID");
  console.log(`- request_id: ${request.request_id}`);
  console.log(`- lead: ${request.lead_name} (${maskPhone(request.to_phone_e164)})`);
  console.log(`- questions: ${request.qualification_questions.length}`);
  console.log(`- timezone: ${request.timezone}`);
  console.log(`- followup channels: ${request.followup_channels.join(", ")}`);
  console.log("- dry-run only: no call was planned and CALL-E was not contacted");
}

export function maskPhone(phone) {
  const raw = String(phone);
  if (!E164_RE.test(raw)) return "***";
  return `${raw.slice(0, 4)}****${raw.slice(-2)}`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
