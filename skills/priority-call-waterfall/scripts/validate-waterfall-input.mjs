#!/usr/bin/env node

import fs from "node:fs";
import { fileURLToPath } from "node:url";

const HELP = `Usage:
  node skills/priority-call-waterfall/scripts/validate-waterfall-input.mjs [options]

Validates a waterfall input payload: one opening plus a priority-ordered candidate
list. Exits 0 and prints the normalized payload when valid; exits 1 with the list of
problems when not.

Options:
  --input <file>   Read JSON input from a file. Use "-" for stdin.
  --help           Show this help.

Input shape:
  {
    "opening": "Check-up, Sunday August 2 at 11:00 AM",
    "candidates": [
      { "name": "Elena Petrova", "phone": "+15550101001", "priority": 1 }
    ],
    "maxCalls": 4,                          // optional
    "deadline": "2026-08-02T16:00:00-04:00" // optional, ISO 8601 with offset
  }
`;

const E164_RE = /^\+[1-9]\d{6,14}$/;

export function validateWaterfallInput(payload) {
  const problems = [];

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { valid: false, problems: ["Input must be a JSON object."] };
  }

  if (typeof payload.opening !== "string" || payload.opening.trim().length === 0) {
    problems.push("opening is required and must be a non-empty string.");
  }

  if (!Array.isArray(payload.candidates) || payload.candidates.length === 0) {
    problems.push("candidates is required and must be a non-empty array.");
  } else {
    const phones = new Set();
    const priorities = new Set();
    payload.candidates.forEach((candidate, index) => {
      const label = `candidates[${index}]`;
      if (typeof candidate !== "object" || candidate === null) {
        problems.push(`${label} must be an object.`);
        return;
      }
      if (typeof candidate.name !== "string" || candidate.name.trim().length === 0) {
        problems.push(`${label}.name is required and must be a non-empty string.`);
      }
      if (typeof candidate.phone !== "string" || !E164_RE.test(candidate.phone)) {
        problems.push(`${label}.phone must be an E.164 number, such as +15550101234.`);
      } else if (phones.has(candidate.phone)) {
        problems.push(`${label}.phone duplicates another candidate. One call per candidate per run.`);
      } else {
        phones.add(candidate.phone);
      }
      if (!Number.isInteger(candidate.priority)) {
        problems.push(`${label}.priority must be an integer (lower calls first).`);
      } else if (priorities.has(candidate.priority)) {
        problems.push(`${label}.priority duplicates another candidate. The calling order must be unambiguous.`);
      } else {
        priorities.add(candidate.priority);
      }
    });
  }

  if (payload.maxCalls !== undefined) {
    if (!Number.isInteger(payload.maxCalls) || payload.maxCalls < 1) {
      problems.push("maxCalls must be a positive integer when provided.");
    }
  }

  if (payload.deadline !== undefined) {
    const parsed = Date.parse(payload.deadline);
    if (typeof payload.deadline !== "string" || Number.isNaN(parsed)) {
      problems.push("deadline must be an ISO 8601 instant when provided.");
    }
  }

  if (problems.length > 0) {
    return { valid: false, problems };
  }

  const candidates = [...payload.candidates].sort((a, b) => a.priority - b.priority);
  const normalized = { opening: payload.opening.trim(), candidates };
  if (payload.maxCalls !== undefined) normalized.maxCalls = payload.maxCalls;
  if (payload.deadline !== undefined) normalized.deadline = payload.deadline;
  return { valid: true, normalized };
}

function maskPhone(phone) {
  return phone.length > 6 ? `${phone.slice(0, 3)}${"*".repeat(phone.length - 5)}${phone.slice(-2)}` : "***";
}

function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return 0;
  }

  const inputIndex = argv.indexOf("--input");
  if (inputIndex === -1 || argv[inputIndex + 1] === undefined) {
    process.stderr.write("Missing required --input <file>. Use --help for usage.\n");
    return 1;
  }
  const source = argv[inputIndex + 1];
  const raw = source === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(source, "utf8");

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    process.stderr.write(`Input is not valid JSON: ${error.message}\n`);
    return 1;
  }

  const result = validateWaterfallInput(payload);
  if (!result.valid) {
    process.stderr.write("Invalid waterfall input:\n");
    for (const problem of result.problems) {
      process.stderr.write(`  - ${problem}\n`);
    }
    return 1;
  }

  const summary = result.normalized.candidates
    .map((candidate) => `  #${candidate.priority} ${candidate.name} ${maskPhone(candidate.phone)}`)
    .join("\n");
  process.stdout.write(`Valid. Calling order:\n${summary}\n`);
  const maskedNormalized = {
    ...result.normalized,
    candidates: result.normalized.candidates.map(c => ({ ...c, phone: maskPhone(c.phone) }))
  };
  process.stdout.write(JSON.stringify(maskedNormalized, null, 2) + "\n");
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
