#!/usr/bin/env node
/**
 * Offline validator for a recall-outreach recipient result.
 *
 * Usage:
 *   node scripts/validate-result.mjs <path-to-result.json> [--allow pickup_request,mail_return]
 *
 * Exits 0 when the result satisfies the contract, 1 otherwise. No network, no CALL-E account.
 * This exists so an integrator can check a result they captured from a real call without
 * running the whole application — and so nobody needs a mock provider to test their handling.
 */
import { readFileSync } from "node:fs";

const ENUMS = {
  right_person_reached: ["yes", "no", "unknown"],
  item_recognized: ["yes", "no", "unknown"],
  item_status: ["still_has_item", "returned", "transferred", "discarded", "unknown"],
  notice_understood: ["yes", "no", "unknown"],
  selected_next_step: ["pickup_request", "mail_return", "store_return", "callback", "none", "unknown"],
  human_follow_up_required: ["yes", "no", "unknown"],
  contact_outcome: ["resolved", "partially_resolved", "not_reached", "escalate", "unknown"],
  certainty: ["high", "medium", "low", "unknown"],
};
const FREE_TEXT = ["preferred_time", "questions"];
const REQUIRED = [...Object.keys(ENUMS), ...FREE_TEXT];

function parseArgs(argv) {
  const file = argv.find((a) => !a.startsWith("--"));
  const allowIndex = argv.indexOf("--allow");
  const allowed = allowIndex >= 0 && argv[allowIndex + 1] ? argv[allowIndex + 1].split(",").map((s) => s.trim()) : null;
  return { file, allowed };
}

const { file, allowed } = parseArgs(process.argv.slice(2));
if (!file) {
  console.error("Usage: node scripts/validate-result.mjs <result.json> [--allow pickup_request,mail_return]");
  process.exit(2);
}

let value;
try {
  value = JSON.parse(readFileSync(file, "utf8"));
} catch (error) {
  console.error(`Could not read ${file}: ${error.message}`);
  process.exit(2);
}

const errors = [];

if (value === null || typeof value !== "object" || Array.isArray(value)) {
  errors.push("Result must be a JSON object.");
} else {
  for (const field of REQUIRED) {
    if (!(field in value)) errors.push(`Missing required field: ${field}`);
  }
  for (const key of Object.keys(value)) {
    if (!REQUIRED.includes(key)) errors.push(`Unexpected field (additionalProperties is false): ${key}`);
  }
  for (const [field, members] of Object.entries(ENUMS)) {
    if (!(field in value)) continue;
    if (typeof value[field] !== "string") errors.push(`${field} must be a string`);
    else if (!members.includes(value[field])) {
      errors.push(`${field} must be one of ${members.join(", ")} — got "${value[field]}"`);
    }
  }
  for (const field of FREE_TEXT) {
    if (field in value && typeof value[field] !== "string") errors.push(`${field} must be a string (use "" for no answer)`);
  }
  if (allowed && typeof value.selected_next_step === "string") {
    const permitted = [...allowed, "callback", "none", "unknown"];
    if (!permitted.includes(value.selected_next_step)) {
      errors.push(
        `selected_next_step "${value.selected_next_step}" is not offered by this campaign (allowed: ${permitted.join(", ")})`,
      );
    }
  }
}

if (errors.length) {
  console.error(`INVALID — ${file}`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error("\nA result that fails this check must be recorded as unusable and routed to a human.");
  console.error("It must never count toward any measure above 'call completed'.");
  process.exit(1);
}

// Valid, but say plainly what it does and does not establish.
const notes = [];
if (value.right_person_reached !== "yes") notes.push("The right person was NOT confirmed reached; no claim about this customer holds.");
if (value.questions.trim()) notes.push("An unanswered question was recorded: this belongs to a human.");
if (value.human_follow_up_required === "yes" || value.contact_outcome === "escalate") notes.push("Flagged for human follow-up.");
if (["low", "unknown"].includes(value.certainty) && value.right_person_reached !== "no") {
  notes.push("Certainty is low or unknown: do not act on these answers without a human check.");
}
if (!["none", "unknown"].includes(value.selected_next_step) && value.right_person_reached === "yes") {
  notes.push(`Next step requested: ${value.selected_next_step}. This is a REQUEST, not a completed return.`);
}

console.log(`VALID — ${file}`);
for (const n of notes) console.log(`  · ${n}`);
console.log("\nReminder: a valid result never means the recall is resolved for this customer.");
console.log("Only a human confirming the physical return can establish that.");
