#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REQUIRED_FIELDS = [
  "request_id",
  "candidate_name",
  "to_phone_e164",
  "role_label",
  "company_name",
  "coordinator_name",
  "authorized_contact_reason",
  "interview_duration_minutes",
  "allowed_windows",
  "timezone",
  "followup_channels"
];

const E164_RE = /^\+[1-9]\d{7,14}$/;
const BANNED_TEXT_RE = /\b(salary|compensation|benefits|visa|immigration|sponsor|sponsorship|age|children|pregnant|religion|race|disability|medical|health|background check|criminal|arrest|married)\b/i;

function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function loadCandidateRequest(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function validateCandidateRequest(request) {
  const errors = [];
  for (const field of REQUIRED_FIELDS) {
    if (request[field] === undefined || request[field] === null || request[field] === "") {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (request.to_phone_e164 && !E164_RE.test(String(request.to_phone_e164))) {
    errors.push("to_phone_e164 must be E.164, for example +15550101337");
  }

  if (!Number.isInteger(request.interview_duration_minutes) || request.interview_duration_minutes < 5 || request.interview_duration_minutes > 240) {
    errors.push("interview_duration_minutes must be an integer between 5 and 240");
  }

  if (!Array.isArray(request.allowed_windows) || request.allowed_windows.length === 0) {
    errors.push("allowed_windows must be a non-empty array");
  } else {
    request.allowed_windows.forEach((window, index) => {
      if (!window || typeof window !== "object" || !window.start || !window.end) {
        errors.push(`allowed_windows[${index}] must include start and end`);
        return;
      }
      const start = Date.parse(window.start);
      const end = Date.parse(window.end);
      if (Number.isNaN(start) || Number.isNaN(end)) {
        errors.push(`allowed_windows[${index}] start/end must be parseable dates`);
      } else if (end <= start) {
        errors.push(`allowed_windows[${index}] end must be after start`);
      }
    });
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

  if (request.timezone && !isValidTimeZone(String(request.timezone))) {
    errors.push("timezone must be a valid IANA timezone, for example America/New_York");
  }

  const textFields = [
    request.authorized_contact_reason,
    request.candidate_context,
    request.voicemail_message
  ].filter(Boolean).join(" ");

  if (BANNED_TEXT_RE.test(textFields)) {
    errors.push("Request text appears to include sensitive recruiting topics; keep the call to availability coordination only");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function maskPhone(phone) {
  const text = String(phone);
  if (text.length <= 6) return "***";
  return `${text.slice(0, 3)}${"*".repeat(Math.max(3, text.length - 6))}${text.slice(-3)}`;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: node scripts/validate-candidate-input.mjs assets/sample-candidate-request.json");
    process.exit(2);
  }

  const request = loadCandidateRequest(path);
  const result = validateCandidateRequest(request);
  const summary = {
    ...result,
    request_id: request.request_id,
    candidate_name: request.candidate_name,
    masked_to_phone: request.to_phone_e164 ? maskPhone(request.to_phone_e164) : undefined,
    allowed_window_count: Array.isArray(request.allowed_windows) ? request.allowed_windows.length : 0
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(result.valid ? 0 : 1);
}
