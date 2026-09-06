#!/usr/bin/env node
/**
 * check-goal-compatibility.mjs — can this published CALL-E Goal actually
 * answer this verification goal?
 *
 * A published Goal owns its own result schema. It can be perfectly healthy
 * and still be structurally unable to settle one of your hard constraints,
 * because no declared field can carry the answer. Running it anyway spends a
 * real phone call on a real person and returns a constraint that can only
 * ever be UNKNOWN.
 *
 * Run this BEFORE the first goals.run of a new pairing, and in CI whenever a
 * Goal's published version changes.
 *
 * Usage:
 *   # Against a live Goal (needs CALLE_API_KEY; read-only, places no call):
 *   CALLE_API_KEY=... node check-goal-compatibility.mjs goal.json --goal-id goal_abc
 *
 *   # Fully offline, against a saved Goal document:
 *   node check-goal-compatibility.mjs goal.json --spec published-goal.json
 *
 * goal.json is the same verification-goal shape build-call-task.mjs takes:
 * {
 *   "item": "XZ-420 compressor",
 *   "targetEquipment": "ACME HVAC-200",
 *   "constraints": [
 *     { "kind": "availability" },
 *     { "kind": "compatibility" },
 *     { "kind": "price_max", "params": { "max": 25000, "currency": "INR" } },
 *     { "kind": "hold_until", "params": { "until": "5 PM" } }
 *   ]
 * }
 *
 * published-goal.json is a CALL-E Goal document (what goals.get returns), or
 * just its `publishedRunSpec`.
 *
 * Exit codes: 0 compatible, 1 invalid input, 2 INCOMPATIBLE, 3 fetch failed.
 */
import { readFileSync } from "node:fs";

// Result-field families. A Goal may name things its own way; the first
// declared field in a family wins.
const RESULT_FIELDS = {
  availability: ["availability", "in_stock", "stock_status"],
  compatibility: ["compatibility", "compatible", "fits"],
  price_max: ["price", "quoted_price", "total_price"],
  quantity_min: ["quantity", "units_available", "stock_count"],
  pickup_today: ["pickup_available", "pickup_today", "can_pickup"],
  hold_until: ["hold_confirmed", "hold_available", "will_hold"],
  deadline: ["pickup_time", "ready_time", "lead_time"],
};

// Settled from candidate data, never from the call — a Goal is never
// required to answer these.
const NON_PHONE_KINDS = new Set(["distance_max"]);

function die(code, message) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function readJson(path, code) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    die(code, `Cannot read JSON from ${path}: ${error.message}`);
  }
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** Variables GroundTruth can supply, from the goal itself. */
function availableVariables(goal) {
  const vars = { item: goal.item, supplier_name: "<per candidate>" };
  if (goal.targetEquipment) vars.target_equipment = goal.targetEquipment;
  for (const c of goal.constraints ?? []) {
    const p = c.params ?? {};
    if (c.kind === "price_max" && p.max !== undefined) {
      vars.max_price = p.max;
      if (p.currency) vars.currency = p.currency;
    }
    if (c.kind === "quantity_min" && p.min !== undefined) vars.min_quantity = p.min;
    if (c.kind === "hold_until" && p.until !== undefined) vars.hold_until = String(p.until);
    if (c.kind === "deadline" && p.by !== undefined) vars.deadline = String(p.by);
  }
  vars.distance_km = 0; // always suppliable from candidate data
  return vars;
}

function props(schema) {
  return schema && typeof schema.properties === "object" ? schema.properties : {};
}

function check(runSpec, goal) {
  const resultFields = new Set(Object.keys(props(runSpec.resultSchema)));
  const required = Array.isArray(runSpec.inputSchema?.required) ? runSpec.inputSchema.required : [];
  const vars = availableVariables(goal);

  const bindings = [];
  const unanswerable = [];
  for (const c of goal.constraints ?? []) {
    if (NON_PHONE_KINDS.has(c.kind)) continue;
    const family = RESULT_FIELDS[c.kind] ?? [c.claimKey ?? c.kind];
    const match = family.find((f) => resultFields.has(f));
    if (match) bindings.push({ kind: c.kind, resultField: match });
    else unanswerable.push({ kind: c.kind, lookedFor: family });
  }
  const missingVariables = required.filter((v) => vars[v] === undefined);

  return {
    compatible: unanswerable.length === 0 && missingVariables.length === 0,
    bindings,
    unanswerable,
    missingVariables,
    declaredResultFields: [...resultFields],
  };
}

async function fetchGoal(goalId) {
  const apiKey = process.env.CALLE_API_KEY;
  if (!apiKey) die(1, "CALLE_API_KEY is required to fetch a live Goal (or pass --spec).");
  let CalleClient;
  try {
    ({ CalleClient } = await import("@call-e/calle"));
  } catch {
    die(1, "@call-e/calle is not installed. Install it, or pass --spec with a saved Goal document.");
  }
  const client = new CalleClient({
    apiKey,
    baseUrl: process.env.CALLE_BASE_URL ?? "https://api.heycall-e.com",
  });
  try {
    // Read-only. This places no call.
    return await client.goals.get(goalId);
  } catch (error) {
    die(3, `Could not fetch Goal ${goalId}: ${error.message}`);
  }
}

const goalPath = process.argv[2];
if (!goalPath || goalPath.startsWith("--")) {
  die(1, "Usage: check-goal-compatibility.mjs goal.json (--goal-id <id> | --spec <published-goal.json>)");
}

const goal = readJson(goalPath, 1);
if (!goal.item || !Array.isArray(goal.constraints) || goal.constraints.length === 0) {
  die(1, "goal.json needs `item` and a non-empty `constraints` array.");
}

const specPath = arg("--spec");
const goalId = arg("--goal-id");

let goalDoc;
if (specPath) goalDoc = readJson(specPath, 1);
else if (goalId) goalDoc = await fetchGoal(goalId);
else die(1, "Pass either --goal-id <id> (live) or --spec <published-goal.json> (offline).");

// Accept either a full Goal document or a bare publishedRunSpec.
const runSpec = goalDoc.publishedRunSpec ?? goalDoc;
if (!runSpec.resultSchema) {
  die(1, "The Goal document has no publishedRunSpec.resultSchema.");
}

const report = check(runSpec, goal);
const name = goalDoc.title ?? goalDoc.id ?? goalId ?? "goal";
const version = runSpec.version ?? "?";

process.stdout.write(
  `${JSON.stringify(
    {
      goal: name,
      runSpecVersion: version,
      compatible: report.compatible,
      bindings: report.bindings,
      unanswerable: report.unanswerable,
      missingVariables: report.missingVariables,
      declaredResultFields: report.declaredResultFields,
    },
    null,
    2,
  )}\n`,
);

if (!report.compatible) {
  const reasons = [];
  if (report.unanswerable.length > 0) {
    reasons.push(
      `no declared result field for: ${report.unanswerable.map((u) => u.kind).join(", ")}`,
    );
  }
  if (report.missingVariables.length > 0) {
    reasons.push(`required input variable(s) unavailable: ${report.missingVariables.join(", ")}`);
  }
  die(
    2,
    `INCOMPATIBLE — "${name}" v${version} cannot verify this goal (${reasons.join("; ")}). Do not run it: the constraint would stay UNKNOWN after a real call.`,
  );
}

process.stderr.write(
  `COMPATIBLE — "${name}" v${version} can answer all ${report.bindings.length} phone-derived constraint(s).\n`,
);
