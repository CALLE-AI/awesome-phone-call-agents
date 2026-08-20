#!/usr/bin/env node

const HELP = `Usage:
  node skills/call-outcome-reconciler/scripts/validate-outcome-record.mjs --record <path> [--help]

Validates one outcome record against the contract in references/outcome-contract.md.

Checks the guarantees a consumer is entitled to rely on:
  * exactly one of the six outcomes
  * an unresolved record carries a machine-readable reason and claims no mapping
  * a semantic outcome names the mapping entry that produced it
  * raw payloads are present and unpruned
  * the recipient is masked

Exits 0 when the record is valid, 1 when it is not.
`;

import { readFileSync } from "node:fs";

const OUTCOMES = [
  "completed",
  "not_connected",
  "declined",
  "infrastructure_failure",
  "cancelled",
  "unresolved",
];

const REASONS = [
  "polling_budget_exhausted",
  "undocumented_code",
  "undocumented_failure_detail",
  "ambiguous_documented_code",
  "result_error_not_call_outcome",
  "inconsistent_payload",
  "plan_timeout",
  "malformed_payload",
  "no_observations",
];

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validate(record) {
  const problems = [];
  const fail = (message) => problems.push(message);

  if (!isObject(record)) {
    return ["Record is not a JSON object"];
  }

  if (record.schema_version !== 1) {
    fail(`Unsupported schema_version: ${JSON.stringify(record.schema_version)}`);
  }
  if (typeof record.call_ref !== "string" || record.call_ref.length === 0) {
    fail("call_ref must be a non-empty string");
  }
  if (!OUTCOMES.includes(record.outcome)) {
    fail(`outcome must be one of ${OUTCOMES.join(", ")}; got ${JSON.stringify(record.outcome)}`);
  }

  const mapping = record.mapping;
  if (!isObject(mapping)) {
    fail("mapping block is missing");
  } else {
    if (typeof mapping.matched !== "boolean") {
      fail("mapping.matched must be a boolean");
    }
    if (typeof mapping.map_version !== "string" || mapping.map_version.length === 0) {
      fail("mapping.map_version must be a non-empty string");
    }
    if (record.outcome === "unresolved") {
      if (mapping.matched !== false) {
        fail("an unresolved record must not claim a mapping match");
      }
      if (mapping.entry_id !== null) {
        fail("an unresolved record must not name a mapping entry");
      }
    } else {
      if (mapping.matched !== true) {
        fail(`a ${record.outcome} record must report mapping.matched = true`);
      }
      if (typeof mapping.entry_id !== "string" || mapping.entry_id.length === 0) {
        fail("a semantic outcome must name the mapping entry that produced it");
      }
    }
  }

  if (record.outcome === "unresolved") {
    if (!REASONS.includes(record.reason)) {
      fail(`an unresolved record needs a known reason; got ${JSON.stringify(record.reason)}`);
    }
  } else if (record.reason !== null && record.reason !== undefined) {
    fail("a resolved record must not carry an unresolved reason");
  }

  const timing = record.timing;
  if (!isObject(timing)) {
    fail("timing block is missing");
  } else if (!Number.isInteger(timing.observation_count) || timing.observation_count < 0) {
    fail("timing.observation_count must be a non-negative integer");
  }

  const evidence = record.evidence;
  if (!isObject(evidence)) {
    fail("evidence block is missing");
  } else {
    for (const key of ["observed_states", "notes", "decision"]) {
      if (!Array.isArray(evidence[key])) {
        fail(`evidence.${key} must be an array`);
      }
    }
  }

  const raw = record.raw;
  if (!isObject(raw)) {
    fail("raw block is missing; upstream payloads must be preserved verbatim");
  } else {
    for (const key of ["first_payload", "last_payload"]) {
      if (!(key in raw)) {
        fail(`raw.${key} must be present, even when null`);
      }
    }
  }

  const recipient = record.recipient;
  if (!isObject(recipient)) {
    fail("recipient block is missing");
  } else {
    const masked = recipient.phone_e164_masked;
    if (masked !== null && masked !== undefined) {
      if (typeof masked !== "string") {
        fail("recipient.phone_e164_masked must be a string or null");
      } else if (!masked.includes("*")) {
        fail(`recipient.phone_e164_masked is not masked: ${masked}`);
      }
    }
  }

  return problems;
}

function main(argv) {
  if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
    process.stdout.write(HELP);
    return argv.length === 0 ? 1 : 0;
  }
  const index = argv.indexOf("--record");
  if (index === -1 || !argv[index + 1]) {
    process.stderr.write("Missing --record <path>\n");
    return 1;
  }
  const path = argv[index + 1];

  let record;
  try {
    record = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    process.stderr.write(`Cannot read record at ${path}: ${error.message}\n`);
    return 1;
  }

  const problems = validate(record);
  if (problems.length === 0) {
    process.stdout.write(`Outcome record is valid: ${path}\n`);
    return 0;
  }
  process.stderr.write(`Outcome record is invalid: ${path}\n`);
  for (const problem of problems) {
    process.stderr.write(`  - ${problem}\n`);
  }
  return 1;
}

process.exit(main(process.argv.slice(2)));
