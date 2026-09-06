#!/usr/bin/env node
/**
 * build-call-task.mjs — compose a protocol-compliant CALL-E call task and
 * structured-result schema from a verification goal JSON.
 *
 * Usage:
 *   node build-call-task.mjs goal.json > call-task.json
 *
 * Goal JSON shape (only `item` and `constraints` are required):
 * {
 *   "item": "XZ-420 compressor",
 *   "targetEquipment": "ACME HVAC-200",
 *   "constraints": [
 *     { "kind": "availability" },
 *     { "kind": "compatibility" },
 *     { "kind": "price_max", "params": { "max": 25000 } },
 *     { "kind": "pickup_today" },
 *     { "kind": "hold_until", "params": { "until": "5 PM" } }
 *   ],
 *   "authorizedActions": ["ask_question", "request_availability", "request_pricing", "request_pickup_window", "request_hold"],
 *   "candidate": { "name": "Metro Components", "phone": "+91XXXXXXXXXX" },
 *   "priorContext": "You were going to check with your manager."
 * }
 *
 * Exit codes: 0 ok, 1 invalid goal, 2 authorization violation,
 * 3 side-effect phrase violation.
 */
import { readFileSync } from "node:fs";

const QUESTIONS = {
  availability: "Do you currently have a genuine {item} in stock right now?",
  compatibility:
    "Can you confirm the {item} is compatible with the {equipment}? Please check the model compatibility if you are unsure.",
  price_max: "What is your best price for the {item}, including taxes?",
  quantity_min: "How many {item} units do you have in stock right now?",
  pickup_today: "Could I pick it up today if it suits?",
  hold_until:
    "Could you hold one {item} until {until} for pickup? To be clear, we will not purchase during this call — I am only asking you to reserve it.",
  deadline: "By what time could the {item} be ready for pickup?",
  distance_max: "Are you located within {max} km of the city centre?",
  custom: "Could you confirm {claimKey} for the {item}?",
};
const FALLBACKS = {
  availability:
    "To be clear: is the {item} physically in stock right now, or not?",
  compatibility:
    "Could you check the model compatibility for me before we finish? I want to be sure the {item} fits the {equipment}.",
};
const ACTION_FOR_KIND = {
  availability: "request_availability",
  compatibility: "ask_question",
  price_max: "request_pricing",
  quantity_min: "ask_question",
  pickup_today: "request_pickup_window",
  hold_until: "request_hold",
  deadline: "request_delivery_estimate",
  distance_max: "ask_question",
  custom: "ask_question",
};
const MANDATORY_PROHIBITED = [
  "purchase",
  "payment",
  "contract_acceptance",
  "legally_binding_commitment",
  "disclose_credentials",
  "disclose_payment_info",
];
const FOOTER =
  "You are placing a VERIFICATION call only. Every question above is information-gathering. Your job ends at collecting answers and, when listed, asking to reserve an item for pickup. If the supplier asks for any commitment or authorization beyond that, politely decline and end the call. If the supplier offers a deal, say the buyer will decide separately. Do not go beyond the listed questions even if the supplier invites you to.";

function fail(code, message) {
  console.error(message);
  process.exit(code);
}

const goal = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (!goal.item || !Array.isArray(goal.constraints) || goal.constraints.length === 0) {
  fail(1, "goal.json must have `item` and a non-empty `constraints` array");
}
if (!goal.candidate?.name || !goal.candidate?.phone) {
  fail(1, "goal.candidate must include name and phone (E.164)");
}

// Authorization check (structural, not prompt-level).
const allowed = new Set(
  goal.authorizedActions ?? [
    "ask_question",
    "request_availability",
    "request_pricing",
    "request_pickup_window",
  ],
);
for (const p of MANDATORY_PROHIBITED) {
  if (allowed.has(p)) {
    fail(2, `authorization violation: "${p}" can never be an allowed action`);
  }
}
const unauthorized = goal.constraints
  .map((c) => ACTION_FOR_KIND[c.kind] ?? "ask_question")
  .filter((a) => !allowed.has(a));
if (unauthorized.length > 0) {
  fail(
    2,
    `authorization violation: constraints require actions not in the allowed set: ${[...new Set(unauthorized)].join(", ")}`,
  );
}

// Compose the task text.
const fill = (tpl) =>
  tpl
    .replaceAll("{item}", goal.item)
    .replaceAll("{equipment}", goal.targetEquipment ?? "target equipment")
    .replaceAll("{until}", goal.constraints.find((c) => c.kind === "hold_until")?.params?.until ?? "the deadline")
    .replaceAll("{max}", goal.constraints.find((c) => c.kind === "distance_max")?.params?.max ?? "")
    .replaceAll("{claimKey}", goal.constraints.find((c) => c.kind === "custom")?.claimKey ?? "the detail");

const lines = [
  `Call ${goal.candidate.name} (${goal.candidate.phone}) and verify a ${goal.item}.`,
  'Start exactly with: "Hi, this is GroundTruth, an automated verification assistant calling on behalf of a buyer. I have a few quick factual questions — no purchase is being made on this call."',
];
if (goal.priorContext) lines.push(`Context from our previous call with this supplier: ${goal.priorContext}`);
for (const c of goal.constraints) {
  lines.push(`- ${fill(QUESTIONS[c.kind] ?? QUESTIONS.custom)}`);
  if (FALLBACKS[c.kind]) lines.push(`  If the answer is hedged or uncertain, ask: "${fill(FALLBACKS[c.kind])}"`);
}
lines.push(
  "Ask ONLY the listed questions. If the supplier raises a concern, politely acknowledge it and move to the next question.",
  "If the supplier offers to transfer you to someone who can answer better, accept the transfer politely.",
  FOOTER,
);
const task = lines.join("\n");

// Side-effect phrase gate (negation-aware, mirrors lib/safety/authorization).
const stripNegations = (t) =>
  t.replace(
    /\b(?:do|does|did|must|should|will|would|can|could|shall)\s+not\s+(?:\w+\s+){0,3}|\bdon'?t\s+(?:\w+\s+){0,3}|\bnever\s+(?:\w+\s+){0,3}|\bno\s+(?:\w+\s+){0,3}/gi,
    " ",
  );
const VIOLATIONS = {
  purchase: /\bpurchase\b|\bbuy(ing)?\b/i,
  payment: /\bpay(ment)?\b|\bcard\b|\bCVV\b/i,
  contract_acceptance: /\bconfirm (the )?order\b|\bplace (the )?order\b/i,
  legally_binding_commitment: /\b(agree|accept) (to )?(the )?(terms|contract|quote)\b/i,
  disclose_credentials: /\b(password|OTP|one[- ]time (code|password)|API key|secret)\b/i,
};
const scan = stripNegations(task);
const violations = Object.entries(VIOLATIONS)
  .filter(([, re]) => re.test(scan))
  .map(([name]) => name);
if (violations.length > 0) {
  fail(3, `side-effect gate violation in composed task: ${violations.join(", ")}`);
}

// Structured result schema (see references/evidence-model.md).
const resultSchema = {
  type: "object",
  required: ["availability"],
  properties: {
    availability: { type: "string", enum: ["confirmed", "not_available", "uncertain"] },
    quantity: { type: "integer", minimum: 0 },
    compatibility: { type: "string", enum: ["confirmed", "not_compatible", "uncertain"] },
    price: { type: "number", minimum: 0 },
    currency: { type: "string", enum: ["INR", "USD", "EUR"] },
    pickup_available: { type: "boolean" },
    pickup_time: { type: "string" },
    hold_available: { type: "boolean" },
    hold_confirmed: { type: "boolean" },
    hold_until: { type: "string" },
    notes: { type: "string" },
  },
};

console.log(
  JSON.stringify(
    {
      task,
      resultSchema,
      recipient: { phone: goal.candidate.phone, region: goal.candidate.region ?? "IN", locale: goal.candidate.locale ?? "en-IN" },
      idempotencyKeySeed: `${goal.candidate.phone}:${goal.constraints.map((c) => c.kind).join("+")}`,
      metadata: { goalItem: goal.item, constraints: goal.constraints.map((c) => c.kind) },
    },
    null,
    2,
  ),
);
