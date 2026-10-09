#!/usr/bin/env node
/**
 * Dry-run preview for call-the-parts. Builds CALL-E goal text. Does not dial.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const CONDITIONS = new Set(["used", "rebuilt", "new_aftermarket", "any"]);
const E164 = /^\+[1-9]\d{7,14}$/;

function readJson(pathOrStdin) {
  if (!pathOrStdin || pathOrStdin === "-") {
    return JSON.parse(readFileSync(0, "utf8"));
  }
  return JSON.parse(readFileSync(pathOrStdin, "utf8"));
}

function maskPhone(phone) {
  if (phone.length < 6) return "+••••";
  return `${phone.slice(0, 5)}…${phone.slice(-4)}`;
}

function fail(message) {
  console.error(`status: not called\nblocker: ${message}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    input: { type: "string", short: "i" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: false,
});

if (values.help) {
  console.log("Usage: node scripts/preview-shop-call.mjs [--input request.json]");
  process.exit(0);
}

const input = readJson(values.input);
const required = [
  "requestId",
  "year",
  "make",
  "model",
  "part",
  "condition",
  "shopName",
  "phone",
  "organization",
];
for (const key of required) {
  if (input[key] === undefined || input[key] === "") {
    fail(`missing field ${key}`);
  }
}

if (!CONDITIONS.has(input.condition)) {
  fail(`condition must be one of ${[...CONDITIONS].join(", ")}`);
}
if (!E164.test(String(input.phone))) {
  fail("phone must be E.164, like +15551234567");
}

const year = Number(input.year);
if (!Number.isInteger(year) || year < 1950 || year > 2030) {
  fail("year must be an integer between 1950 and 2030");
}

const notes = input.extraNotes ? ` Extra fitment note: ${input.extraNotes}.` : "";
const goal = [
  `This is an automated call on behalf of ${input.organization}.`,
  `I am checking used automotive part availability. Request ${input.requestId}.`,
  `Ask the authorized contact at ${input.shopName}.`,
  `Ask whether they have a ${input.condition} ${input.part} for a ${year} ${input.make} ${input.model}.`,
  `If they need to check the shelves or a computer, wait.`,
  `Ask for condition, the price as they say it, any core charge, whether they can hold it and until when, and pickup vs ship.`,
  `If they do not have this exact part, ask whether a similar interchange exists.`,
  `Do not negotiate. Do not agree to buy, hold, or pay.`,
  `If they ask not to be called again, apologize and end.`,
  `Extract only: in_stock (yes|no|maybe|unknown), condition_reported, price_spoken, core_charge_spoken, hold_offered (yes|no|unknown), hold_until_spoken, pickup_or_ship (pickup|ship|either|unknown), interchange_or_notes, callback_required, outcome (answered|declined|no_answer|voicemail|unknown).`,
  notes,
]
  .filter(Boolean)
  .join(" ");

const preview = {
  mode: "dry-run",
  dialed: false,
  requestId: input.requestId,
  shopName: input.shopName,
  phoneMasked: maskPhone(String(input.phone)),
  vehicle: `${year} ${input.make} ${input.model}`,
  part: input.part,
  condition: input.condition,
  organization: input.organization,
  calleGoal: goal,
  next: "If the user authorizes this request, run calle call plan then calle call start with this phone and goal.",
};

// Only the displayed copy is masked; keep the private request unchanged.
console.log(JSON.stringify(preview, (_, value) => typeof value === "string"
  ? value.replace(/\+?\d[\d ().-]{5,}\d/g, "[PHONE]") : value, 2));
