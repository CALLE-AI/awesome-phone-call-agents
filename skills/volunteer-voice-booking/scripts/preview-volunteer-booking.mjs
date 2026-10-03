#!/usr/bin/env node
// Preview a volunteer voice booking request without placing a call.
//
// This is a no-call, no-network preview. It reads a request JSON, masks the
// phone number, shows the free slots and qualification questions, prints the
// redacted CALL-E planning command and the structured result shape, and
// confirms nothing is dispatched or written to a calendar.
//
// Usage:
//   node scripts/preview-volunteer-booking.mjs assets/sample-volunteer-request.json

import { readFileSync } from "node:fs";

const REQUIRED = [
  "request_id",
  "volunteer_name",
  "to_phone_e164",
  "organization_name",
  "booking_purpose",
  "slot_duration_minutes",
  "free_slots",
  "qualification_questions",
  "timezone",
];

const DISPOSITIONS = [
  "booked",
  "declined",
  "voicemail",
  "no_answer",
  "wrong_number",
  "needs_human_review",
];

function maskPhone(e164) {
  if (typeof e164 !== "string" || e164.length < 6) return "***";
  return e164.slice(0, 3) + "******" + e164.slice(-3);
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function main() {
  const path = process.argv[2];
  if (!path) {
    fail(
      "missing input path. Usage: node scripts/preview-volunteer-booking.mjs assets/sample-volunteer-request.json",
    );
  }

  let input;
  try {
    input = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    fail(`could not read JSON at ${path}: ${err.message}`);
  }

  for (const field of REQUIRED) {
    if (input[field] === undefined || input[field] === null || input[field] === "") {
      fail(`missing required field: ${field}`);
    }
  }

  if (!Array.isArray(input.free_slots) || input.free_slots.length === 0) {
    fail("free_slots must be a non-empty array (no availability to offer)");
  }

  const planCommand =
    `calle call plan --to-phone '<E164_PHONE>' --goal '<reviewed goal text>' ` +
    `--timezone ${input.timezone} --language ${input.language || "English"}`;

  const preview = {
    dry_run: true,
    request_id: input.request_id,
    masked_to_phone: maskPhone(input.to_phone_e164),
    booking_purpose: input.booking_purpose,
    slot_duration_minutes: input.slot_duration_minutes,
    timezone: input.timezone,
    free_slots: input.free_slots,
    qualification_questions: input.qualification_questions,
    disposition_options: DISPOSITIONS,
    calle_cli_plan_command_preview: planCommand,
    structured_result_shape: {
      disposition:
        "booked | declined | voicemail | no_answer | wrong_number | needs_human_review",
      request_id: "string",
      volunteer_name: "string",
      booking_purpose: "onsite | online | partnership | other",
      selected_slot: { start: "string", timezone: "string" },
      consent_to_book:
        "boolean; true only when the volunteer explicitly consents",
      followup_preference: "phone | email | none",
      voicemail_left: false,
      needs_human_review: true,
      evidence: [{ claim: "string", transcript_span: "string" }],
      do_not_rely_on: ["string"],
      notes: "string",
    },
    would_place_call: false,
    would_write_calendar: false,
  };

  console.log(JSON.stringify(preview, null, 2));
}

main();
