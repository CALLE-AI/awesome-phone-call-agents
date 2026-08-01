#!/usr/bin/env node
/**
 * Tier classifier for confidence-gated CALL-E results.
 *
 * Pure functions, no I/O, no network. Given a terminal call and the schema the
 * workflow asked for, decide COMMIT / REPAIR / ESCALATE and, when repairing,
 * build the narrowed sub-schema and the idempotency key.
 *
 * Usage as a library:
 *   import { classify, buildRepairPlan } from "./scripts/classify-result.mjs";
 *
 * Usage as a CLI (reads a call JSON, prints the tier decision):
 *   node scripts/classify-result.mjs --call call.json --required a,b --blocking a
 */

export const COMMIT = "COMMIT";
export const REPAIR = "REPAIR";
export const ESCALATE = "ESCALATE";

/**
 * Below this, a "completed" call is a hangup rather than a conversation, and a
 * repair call would mean immediately ringing back someone who just declined.
 */
export const MIN_CONVERSATION_SECONDS = 15;

/** Fields that must never be the target of an automated repair call. */
export const SENSITIVE_FIELDS = [
  "card", "cvv", "iban", "account_number", "routing",
  "ssn", "national_id", "passport", "password", "otp", "pin",
  "diagnosis", "medication", "health",
];

export function isSensitiveField(name) {
  const n = String(name).toLowerCase();
  return SENSITIVE_FIELDS.some((s) => n.includes(s));
}

function present(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Required fields that did not come back usable. */
export function missingFields(result, required) {
  if (!result || typeof result !== "object") return [...required];
  return required.filter((f) => !present(result[f]));
}

/**
 * Detect a result that contradicts itself. Pairs are workflow-defined: each is
 * two field names that must not both be truthy.
 */
export function findContradictions(result, exclusivePairs = []) {
  if (!result || typeof result !== "object") return [];
  return exclusivePairs
    .filter(([a, b]) => result[a] === true && result[b] === true)
    .map(([a, b]) => `${a}=true & ${b}=true`);
}

/**
 * Classify one terminal call.
 *
 * @param {object} call      { status, duration_seconds, structured_result }
 * @param {object} options
 * @param {string[]} options.required        every required field
 * @param {string[]} [options.blocking]      subset that actually blocks the workflow
 *                                           (defaults to `required`)
 * @param {Array<[string,string]>} [options.exclusivePairs]
 * @param {number} [options.turnCount]       from GET /v1/calls/{id}/events
 * @param {boolean} [options.repairAlreadyPlaced]
 */
export function classify(call, options = {}) {
  const {
    required = [],
    blocking = required,
    exclusivePairs = [],
    turnCount = null,
    repairAlreadyPlaced = false,
  } = options;

  const status = String(call?.status || "").toLowerCase();
  const result = call?.structured_result ?? null;
  const duration = Number(call?.duration_seconds ?? 0);

  if (status !== "completed") {
    return {
      tier: ESCALATE,
      reason: `not_answered:${status || "unknown"}`,
      detail: "Reachability is the caller's retry policy, not a confidence problem.",
      missing: [...required],
    };
  }

  const contradictions = findContradictions(result, exclusivePairs);
  if (contradictions.length > 0) {
    return {
      tier: ESCALATE,
      reason: "contradictory_result",
      detail: contradictions.join("; "),
      missing: [],
    };
  }

  const missing = missingFields(result, required);
  const missingBlocking = missing.filter((f) => blocking.includes(f));

  if (missingBlocking.length === 0) {
    return {
      tier: COMMIT,
      reason: missing.length === 0 ? "complete" : "all_blocking_fields_present",
      detail: missing.length === 0 ? "" : `Dropped non-blocking: ${missing.join(", ")}`,
      missing,
    };
  }

  const sensitive = missingBlocking.filter(isSensitiveField);
  if (sensitive.length > 0) {
    return {
      tier: ESCALATE,
      reason: "sensitive_field_missing",
      detail: `A repair call must never target: ${sensitive.join(", ")}`,
      missing: missingBlocking,
    };
  }

  if (repairAlreadyPlaced) {
    return {
      tier: ESCALATE,
      reason: "repair_already_attempted",
      detail: "One repair call per original call. Hand to a human with the trail.",
      missing: missingBlocking,
    };
  }

  // A short call that produced nothing is a hangup, not an extraction failure.
  const trivial = turnCount !== null ? turnCount <= 1 : duration < MIN_CONVERSATION_SECONDS;
  if (trivial) {
    return {
      tier: ESCALATE,
      reason: "conversation_too_short_to_repair",
      detail: `duration=${duration}s turns=${turnCount ?? "unknown"} — treat as a soft refusal.`,
      missing: missingBlocking,
    };
  }

  return {
    tier: REPAIR,
    reason: "extraction_failed_after_real_conversation",
    detail: `duration=${duration}s turns=${turnCount ?? "unknown"}`,
    missing: missingBlocking,
  };
}

/**
 * Build the narrowed repair call. The schema is always a strict SUBSET of the
 * original required fields, and never re-asks a field already captured.
 */
export function buildRepairPlan(call, decision, { originalCallId, schemaProperties = {} } = {}) {
  if (decision.tier !== REPAIR) {
    throw new Error(`buildRepairPlan requires a REPAIR decision, received ${decision.tier}.`);
  }
  const fields = decision.missing;
  if (fields.length === 0) throw new Error("A repair plan needs at least one missing field.");
  if (fields.some(isSensitiveField)) throw new Error("Refusing to build a repair call for a sensitive field.");

  const callId = originalCallId ?? call?.id;
  const properties = Object.fromEntries(
    fields.map((f) => [f, schemaProperties[f] ?? { type: "string", description: `The ${f.replace(/_/g, " ")}.` }]),
  );

  return {
    idempotencyKey: `repair:${callId}`,
    schema: { type: "object", properties, required: fields },
    fields,
    task: [
      "Hello, we spoke a moment ago and I just need to confirm a couple of quick things.",
      ...fields.map((f, i) => `Question ${i + 1}: please tell me the ${f.replace(/_/g, " ")}.`),
      "Thank you, that is everything. Do not ask about anything else and end the call politely.",
    ].join(" "),
  };
}

/** Merge a repair result over the original, recording which call each field came from. */
export function mergeResults({ original, repair, originalCallId, repairCallId, required = [] }) {
  const merged = {};
  for (const field of required) {
    if (present(original?.[field])) {
      merged[field] = { value: original[field], from: originalCallId };
    } else if (present(repair?.[field])) {
      merged[field] = { value: repair[field], from: repairCallId };
    } else {
      merged[field] = { value: null, from: null };
    }
  }
  return merged;
}

// ---------------------------------------------------------------- CLI

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const { readFile } = await import("node:fs/promises");
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? undefined : args[i + 1];
  };
  const callPath = flag("call");
  if (!callPath) {
    console.error("Usage: node scripts/classify-result.mjs --call <call.json> --required a,b [--blocking a] [--turns N]");
    process.exit(2);
  }
  const call = JSON.parse(await readFile(callPath, "utf8"));
  const required = (flag("required") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const blocking = flag("blocking") ? flag("blocking").split(",").map((s) => s.trim()) : required;
  const turns = flag("turns") !== undefined ? Number(flag("turns")) : null;

  const decision = classify(call, { required, blocking, turnCount: turns });
  const output = { decision };
  if (decision.tier === REPAIR) output.repair = buildRepairPlan(call, decision, { originalCallId: call.id });
  console.log(JSON.stringify(output, null, 2));
  process.exit(decision.tier === COMMIT ? 0 : decision.tier === REPAIR ? 5 : 6);
}
