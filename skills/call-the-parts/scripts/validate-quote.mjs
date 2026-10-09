#!/usr/bin/env node
/**
 * Local quote validator for call-the-parts. No network. No keys.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const ENUMS = {
  in_stock: ["yes", "no", "maybe", "unknown"],
  hold_offered: ["yes", "no", "unknown"],
  pickup_or_ship: ["pickup", "ship", "either", "unknown"],
  outcome: ["answered", "declined", "no_answer", "voicemail", "unknown"],
};

const STRINGS = [
  "condition_reported",
  "price_spoken",
  "core_charge_spoken",
  "hold_until_spoken",
  "interchange_or_notes",
];

const REQUIRED = [
  "in_stock",
  ...STRINGS,
  "hold_offered",
  "pickup_or_ship",
  "callback_required",
  "outcome",
];

function readJson(pathOrStdin) {
  if (!pathOrStdin || pathOrStdin === "-") {
    return JSON.parse(readFileSync(0, "utf8"));
  }
  return JSON.parse(readFileSync(pathOrStdin, "utf8"));
}

const { values } = parseArgs({
  options: {
    input: { type: "string", short: "i" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log("Usage: node scripts/validate-quote.mjs [--input quote.json]");
  process.exit(0);
}

const quote = readJson(values.input);
const accepted = {};
const rejected = [];
const dropped = [];

for (const key of Object.keys(quote)) {
  if (!REQUIRED.includes(key)) dropped.push(key);
}

for (const key of REQUIRED) {
  if (!(key in quote)) {
    rejected.push({ field: key, reason: "missing" });
    continue;
  }
  const value = quote[key];
  if (key === "callback_required") {
    if (typeof value !== "boolean") {
      rejected.push({ field: key, reason: "not boolean" });
    } else {
      accepted[key] = value;
    }
    continue;
  }
  if (ENUMS[key]) {
    if (!ENUMS[key].includes(value)) {
      rejected.push({
        field: key,
        reason: `not one of ${ENUMS[key].join(", ")}`,
      });
    } else {
      accepted[key] = value;
    }
    continue;
  }
  if (typeof value !== "string") {
    rejected.push({ field: key, reason: "not string" });
  } else {
    accepted[key] = value;
  }
}

const humanRequired =
  accepted.in_stock === "maybe" ||
  accepted.in_stock === "unknown" ||
  accepted.outcome === "unknown" ||
  (typeof accepted.price_spoken === "string" &&
    accepted.price_spoken.trim() !== "") ||
  accepted.hold_offered === "yes" ||
  rejected.length > 0;

const report = {
  schema: "call-the-parts-quote/v1",
  valid: rejected.length === 0,
  accepted,
  rejected,
  dropped,
  humanDecisionRequired: humanRequired,
  commitment: "none",
};

// Sanitize display text without changing quote validation or private evidence.
console.log(JSON.stringify(report, (_, value) => typeof value === "string"
  ? value.replace(/\+?\d[\d ().-]{5,}\d/g, "[PHONE]") : value, 2));
process.exit(rejected.length === 0 ? 0 : 2);
