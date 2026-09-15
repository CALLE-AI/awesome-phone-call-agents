#!/usr/bin/env node
// ExactRef — standalone write-gate for spoken identifiers. Zero dependencies, Node 18+.
// Same rules as the ExactRef board (src/lib/provenance.ts, diff.ts, task.ts, wait.ts).
//
//   node scripts/exactref.mjs classify --intended 07198FECTIST --extracted 07198SECTIST --readback
//   node scripts/exactref.mjs verify   --intended 07198FECTIST --extracted 07198SECTIST --typed 07198FECTIST --second-channel
//   node scripts/exactref.mjs compile  --field "off-hire reference" --destination "the supplier desk" --intended 07198FECTIST
//   node scripts/exactref.mjs gate     --call call.json --field identifier --intended 07198FECTIST
//   node scripts/exactref.mjs fixtures
//
// Exit 0 only when the decision is writable. Exit 2 when classified but blocked. Exit 1 on bad input.
// This script never places a call and never reads CALL-E credentials.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ---------- diff ----------

export function normalizeIdentifier(value) {
  return value.replace(/[\s\-_.]/g, "").toUpperCase();
}

export function identifiersEqual(a, b) {
  return normalizeIdentifier(a) === normalizeIdentifier(b);
}

export function diffIdentifiers(intended, extracted) {
  if (intended.length === extracted.length) {
    return [...intended].map((ch, i) => ({
      intended: ch,
      extracted: extracted[i] ?? null,
      mark: ch === extracted[i] ? "same" : "changed",
    }));
  }
  const cells = [];
  let i = 0;
  let j = 0;
  while (i < intended.length || j < extracted.length) {
    const a = intended[i] ?? null;
    const b = extracted[j] ?? null;
    if (a === b) {
      cells.push({ intended: a, extracted: b, mark: "same" });
      i += 1;
      j += 1;
    } else if (a && !b) {
      cells.push({ intended: a, extracted: null, mark: "missing" });
      i += 1;
    } else if (b && !a) {
      cells.push({ intended: null, extracted: b, mark: "extra" });
      j += 1;
    } else {
      cells.push({ intended: a, extracted: b, mark: "changed" });
      i += 1;
      j += 1;
    }
  }
  return cells;
}

export function firstMismatch(intended, extracted) {
  const cells = diffIdentifiers(intended, extracted);
  const index = cells.findIndex((cell) => cell.mark !== "same");
  if (index === -1) return null;
  const cell = cells[index];
  return { index, intended: cell.intended, extracted: cell.extracted, mark: cell.mark };
}

// ---------- provenance ----------

export const PROVENANCE = [
  "unknown",
  "spoken_only",
  "conversational_confirmed",
  "mismatch",
  "independently_verified",
];

export function classifyIdentifier(input) {
  const extracted = input.extracted?.trim() ? input.extracted : null;
  const intended = input.intended?.trim() ? input.intended : null;
  const base = { ...input, extracted, intended };

  if (!extracted) {
    return {
      ...base,
      provenance: "unknown",
      writable: false,
      firstMismatch: null,
      reason: "No identifier was extracted. Do not invent one.",
    };
  }

  if (input.secondChannelMatch && intended && identifiersEqual(extracted, intended)) {
    return {
      ...base,
      provenance: "independently_verified",
      writable: true,
      firstMismatch: null,
      reason: "A second channel matched the intended value. Safe to write that value.",
    };
  }

  if (intended && !identifiersEqual(extracted, intended)) {
    return {
      ...base,
      provenance: "mismatch",
      writable: false,
      firstMismatch: firstMismatch(intended, extracted),
      reason:
        "Extracted value does not match the intended identifier. Readback-plus-yes does not override this.",
    };
  }

  if (input.readbackConfirmed) {
    return {
      ...base,
      provenance: "conversational_confirmed",
      writable: false,
      firstMismatch: null,
      reason:
        "The recipient confirmed a readback. That is conversational evidence, not independent verification.",
    };
  }

  return {
    ...base,
    provenance: "spoken_only",
    writable: false,
    firstMismatch: null,
    reason: "The value was spoken once and has not been independently checked.",
  };
}

export function applyHumanVerification({ observation, typed, claimsSecondChannel }) {
  const value = (typed ?? "").trim();
  if (!claimsSecondChannel || !value) {
    return classifyIdentifier({ ...observation, secondChannelMatch: false });
  }
  const intended = observation.intended;
  if (intended && !identifiersEqual(value, intended)) {
    return {
      ...classifyIdentifier({ ...observation, extracted: value, secondChannelMatch: false }),
      provenance: "mismatch",
      writable: false,
      firstMismatch: firstMismatch(intended, value),
      reason: "You typed a value that does not match the intended identifier. ExactRef will not write it.",
    };
  }
  return classifyIdentifier({
    ...observation,
    extracted: value,
    intended: intended ?? value,
    secondChannelMatch: true,
  });
}

// ---------- task ----------

const LEAK_MARKERS = ["INTENDED:", "expected identifier"];

export function leaksIntendedValue(task, intended) {
  const haystack = task.toUpperCase();
  if (LEAK_MARKERS.some((marker) => haystack.includes(marker.toUpperCase()))) return true;
  const value = intended?.trim();
  if (!value) return false;
  if (haystack.includes(value.toUpperCase())) return true;
  const normalized = normalizeIdentifier(value);
  return normalized.length >= 4 && normalizeIdentifier(task).includes(normalized);
}

export function compileIdentifierTask(input) {
  const facts = (input.factsTheAgentMayState ?? []).map((fact) => `- ${fact}`).join("\n");
  const task = [
    `Call ${input.destinationLabel}. Disclose that you are an automated assistant.`,
    `Purpose: ${input.purpose}`,
    `Ask for the ${input.fieldLabel} as one continuous string.`,
    "Do not interrupt while they speak. Wait for an end marker such as “that's all” or a two-second silence.",
    `Read the entire ${input.fieldLabel} back once. If they say no, ask them to repeat the whole string. Do not guess letters.`,
    "If a letter is ambiguous, ask for a word that starts with that letter. Do not substitute a similar-sounding letter.",
    "If they give a time or date that contradicts an earlier answer, leave both versions and do not pick one.",
    facts
      ? `You may state only these facts:\n${facts}`
      : "Do not volunteer identifiers, account numbers, or guessed values.",
    "Do not invent a confirmation number if they do not give one.",
  ].join("\n\n");

  return {
    task,
    resultSchema: {
      type: "object",
      additionalProperties: false,
      required: ["identifier", "readback_confirmed", "identifier_evidence"],
      properties: {
        identifier: {
          type: ["string", "null"],
          description: "The exact identifier as captured. Null if none was given.",
        },
        readback_confirmed: {
          type: "boolean",
          description: "True only if the recipient confirmed a full readback.",
        },
        identifier_evidence: {
          type: "string",
          description: "One verbatim recipient span that contains the identifier, or empty.",
        },
        unresolved_time: {
          type: ["string", "null"],
          description: "Leave contradictory times here. Do not resolve them in the summary.",
        },
      },
    },
    leaksIntended: leaksIntendedValue(task, input.intended),
  };
}

// ---------- gate: read a CALL-E call object ----------

function pick(obj, ...keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

/**
 * Accepts a CALL-E call JSON from the REST API, SDKs, or `calle call status --json`
 * (top-level or wrapped in `result{}` as the MCP `get_call_run` envelope does).
 * Returns the observation plus wait honesty. Never treats status alone as success.
 */
export function observationFromCall(call, { field = "identifier", intended = null } = {}) {
  const body = call && typeof call.result === "object" && call.result && !call.status ? call.result : call;
  const status = pick(body, "status", "state") ?? null;
  const structured = pick(body, "structured_result", "structuredResult", "result") ?? null;
  const structuredObj = structured && typeof structured === "object" ? structured : null;
  const rawValue = structuredObj ? pick(structuredObj, field) : null;
  const extracted = typeof rawValue === "string" || typeof rawValue === "number" ? String(rawValue) : null;
  const readback = structuredObj ? Boolean(pick(structuredObj, "readback_confirmed", "readbackConfirmed")) : false;
  const evidence = structuredObj ? pick(structuredObj, "identifier_evidence", "identifierEvidence") : null;
  const attempts = pick(body, "attempts", "call_attempts", "callAttempts");
  const hasAttemptActivity = Array.isArray(attempts) ? attempts.length > 0 : Boolean(pick(body, "started_at", "startedAt"));
  const terminal = ["completed", "failed", "canceled", "cancelled"].includes(String(status).toLowerCase());
  const validationFailed = String(status).toLowerCase().includes("validation") || Boolean(pick(body, "result_validation_failed"));

  return {
    observation: {
      field,
      intended,
      extracted,
      readbackConfirmed: readback,
      evidenceKind: evidence ? "verbatim_span" : "none",
      evidenceText: typeof evidence === "string" && evidence ? evidence : null,
      secondChannelMatch: false,
    },
    wait: {
      topLevelStatus: status,
      terminal,
      hasAttemptActivity,
      structuredResultPresent: structuredObj != null,
      note: !terminal
        ? status === "queued" && hasAttemptActivity
          ? "Top-level queued can include an active attempt. Do not create again."
          : "Call has not reached a terminal status. Do not write anything yet."
        : structuredObj == null
          ? "Terminal status without structured_result. Task completion is not extraction. Do not write."
          : validationFailed
            ? "Result validation failed upstream. Treat the extracted value as unknown."
            : "Terminal status with structured_result. Classify before writing.",
    },
  };
}

// ---------- CLI ----------

function hasFlag(args, name) {
  return args.includes(name);
}

function flagValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

function flagValues(args, name) {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === name && args[i + 1] !== undefined && !args[i + 1].startsWith("--")) {
      values.push(args[i + 1]);
      i += 1;
    }
  }
  return values;
}

function observationFromArgs(args) {
  const json = flagValue(args, "--json");
  if (json) return JSON.parse(json);
  return {
    field: flagValue(args, "--field") ?? "identifier",
    intended: flagValue(args, "--intended") ?? null,
    extracted: flagValue(args, "--extracted") ?? null,
    readbackConfirmed: hasFlag(args, "--readback"),
    evidenceKind: flagValue(args, "--evidence-kind") === "verbatim_span" ? "verbatim_span" : "none",
    evidenceText: flagValue(args, "--evidence") ?? null,
    secondChannelMatch: hasFlag(args, "--matched"),
  };
}

const USAGE = `Usage:
  exactref classify --intended <value> --extracted <value> [--readback] [--matched] [--json '{...}']
  exactref verify   --intended <value> --extracted <value> --typed <value> --second-channel
  exactref compile  --field <label> --destination <label> [--purpose <text>] [--fact <text>]... [--intended <value>]
  exactref gate     --call <call.json> [--field identifier] [--intended <value>]
  exactref fixtures   (self-check: exit 1 if any fixture disagrees with its expected provenance)

Exit 0 only when the decision is writable. Exit 2 when blocked. Exit 1 on bad input.
`;

export function run(argv) {
  const [command, ...args] = argv;
  const out = (value) => `${JSON.stringify(value, null, 2)}\n`;
  try {
    if (command === "classify") {
      const decision = classifyIdentifier(observationFromArgs(args));
      return { code: decision.writable ? 0 : 2, stdout: out(decision), stderr: "" };
    }
    if (command === "verify") {
      const decision = applyHumanVerification({
        observation: observationFromArgs(args),
        typed: flagValue(args, "--typed") ?? "",
        claimsSecondChannel: hasFlag(args, "--second-channel"),
      });
      return { code: decision.writable ? 0 : 2, stdout: out(decision), stderr: "" };
    }
    if (command === "compile") {
      const compiled = compileIdentifierTask({
        purpose: flagValue(args, "--purpose") ?? "Obtain the identifier.",
        fieldLabel: flagValue(args, "--field") ?? "identifier",
        destinationLabel: flagValue(args, "--destination") ?? "the destination",
        factsTheAgentMayState: flagValues(args, "--fact"),
        intended: flagValue(args, "--intended") ?? null,
      });
      return {
        code: compiled.leaksIntended ? 2 : 0,
        stdout: out(compiled),
        stderr: compiled.leaksIntended ? "Rejected: intended identifier leaked into the task.\n" : "",
      };
    }
    if (command === "gate") {
      const file = flagValue(args, "--call");
      if (!file) return { code: 1, stdout: "", stderr: "gate requires --call <call.json>\n" };
      const call = JSON.parse(readFileSync(file, "utf8"));
      const { observation, wait } = observationFromCall(call, {
        field: flagValue(args, "--field") ?? "identifier",
        intended: flagValue(args, "--intended") ?? null,
      });
      const decision = wait.terminal && wait.structuredResultPresent
        ? classifyIdentifier(observation)
        : { ...observation, provenance: "unknown", writable: false, firstMismatch: null, reason: wait.note };
      return { code: decision.writable ? 0 : 2, stdout: out({ wait, decision }), stderr: "" };
    }
    if (command === "fixtures") {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const fixtures = JSON.parse(readFileSync(path.join(here, "..", "references", "fixtures.json"), "utf8"));
      const rows = fixtures.map((fx) => {
        const decision = classifyIdentifier(fx.observation);
        const ok = !fx.expect
          || (decision.provenance === fx.expect.provenance && decision.writable === fx.expect.writable);
        return { id: fx.id, title: fx.title, provenance: decision.provenance, writable: decision.writable, firstMismatch: decision.firstMismatch, ok };
      });
      const failed = rows.filter((row) => !row.ok).map((row) => row.id);
      return {
        code: failed.length ? 1 : 0,
        stdout: out(rows),
        stderr: failed.length ? `Fixture self-check failed: ${failed.join(", ")}\n` : "",
      };
    }
    if (command === "--help" || command === "-h" || command === "help") {
      return { code: 0, stdout: USAGE, stderr: "" };
    }
  } catch (error) {
    return { code: 1, stdout: "", stderr: `${error instanceof Error ? error.message : "Command failed."}\n` };
  }
  return { code: 1, stdout: "", stderr: USAGE };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const result = run(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.code);
}
