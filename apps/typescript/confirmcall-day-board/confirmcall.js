#!/usr/bin/env node
/**
 * ConfirmCall Day Board — dry-run / fixture by default.
 * Live mode requires CALLE_API_KEY and --live. Does not write calendars.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE = join(
  __dirname,
  "../../../skills/confirmcall-day-board/assets/sample-day-board.json"
);

function maskPhone(e164) {
  if (!e164 || e164.length < 6) return "***";
  return `${e164.slice(0, 2)}***${e164.slice(-4)}`;
}

function loadBoard(path = SAMPLE) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function planScript(business, apt) {
  const windows = (apt.reschedule_windows || []).join(", ") || "none pre-approved";
  return (
    `You are calling on behalf of ${business}. Ask for ${apt.recipient_first_name}. ` +
    `Disclose this is a confirmation call for their existing ${apt.appointment.service} ` +
    `on ${apt.appointment.starts_at} at ${apt.appointment.location}. ` +
    `Ask if they can still attend. If not, ask decline or reschedule into: ${windows}. ` +
    `No medical/legal/financial advice. No payment. Return yes/no/reschedule only.`
  );
}

const FIXTURES = {
  "apt-maya-1": {
    disposition: "confirmed",
    notes: "Recipient confirmed the booked slot",
    requested_time: null,
  },
  "apt-jordan-2": {
    disposition: "reschedule_requested",
    notes: "Asked for Thursday after 3pm",
    requested_time: "2026-09-11T17:00:00-07:00",
  },
  "apt-eli-3": {
    disposition: "declined",
    notes: "Cannot attend; slot freed for the desk",
    requested_time: null,
  },
};

function assertSafe(apt) {
  if (apt.consent !== true) throw new Error(`${apt.request_id}: consent required`);
  if (!/^\+[1-9]\d{7,14}$/.test(apt.to_phone_e164)) {
    throw new Error(`${apt.request_id}: invalid E.164`);
  }
}

function runPreview(board) {
  console.log(`# Preview — ${board.business_display_name} (${board.timezone})\n`);
  for (const apt of board.appointments) {
    assertSafe(apt);
    console.log(`## ${apt.request_id} → ${apt.recipient_first_name} (${maskPhone(apt.to_phone_e164)})`);
    console.log(planScript(board.business_display_name, apt));
    console.log("");
  }
}

function runFixture(board) {
  console.log(`# Fixture run — ${board.business_display_name}\n`);
  const results = [];
  for (const apt of board.appointments) {
    assertSafe(apt);
    const outcome = FIXTURES[apt.request_id] || {
      disposition: "failed",
      notes: "No fixture",
      requested_time: null,
    };
    const row = { request_id: apt.request_id, ...outcome };
    results.push(row);
    console.log(
      `${apt.request_id} ${apt.recipient_first_name}: ${outcome.disposition}` +
        (outcome.requested_time ? ` → ${outcome.requested_time}` : "")
    );
  }
  console.log("\nJSON:");
  console.log(JSON.stringify(results, null, 2));
  return results;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const board = loadBoard();

  if (args.has("--live")) {
    if (!process.env.CALLE_API_KEY && !process.env.CALL_E_API_KEY) {
      console.error("Live mode requires CALLE_API_KEY. Refusing to dial.");
      process.exit(2);
    }
    console.error(
      "Live CALL-E SDK dialing is not embedded in this minimal awesome-repo demo."
    );
    console.error(
      "Use the full ConfirmCall Next.js app with @call-e/calle, or call CALL-E CLI after preview."
    );
    process.exit(3);
  }

  if (args.has("--preview")) {
    runPreview(board);
    return;
  }

  // default: fixture
  runFixture(board);
}

main();
