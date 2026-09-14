#!/usr/bin/env node

// Deterministic linter for CALL-E call scripts: the free-form `task` text and
// the structured `result_schema`. No dependencies, Node built-ins only.
//
// Usage:
//   node check-call-script.mjs --task-file <path> --schema-file <path>
//   node check-call-script.mjs --task "..." --schema '{...}'
//
// Both inputs are optional independently. Exits 1 if any error-severity
// finding exists, otherwise exits 0, so it can gate a workflow.

import fs from "node:fs";
import { fileURLToPath } from "node:url";

const HELP = `Usage:
  node check-call-script.mjs [options]

Options:
  --task <text>          Task text to lint, given inline.
  --task-file <path>     Task text to lint, read from a file.
  --schema <json>        Result schema JSON to lint, given inline.
  --schema-file <path>   Result schema JSON to lint, read from a file.
  --help                 Show this help.

At least one of --task/--task-file or --schema/--schema-file is required.
`;

// ---------------------------------------------------------------------------
// Shared finding + scoring helpers
// ---------------------------------------------------------------------------

const SEVERITY_WEIGHT = { error: 15, warning: 5, info: 0 };

function addFinding(findings, severity, code, message, suggestion) {
  findings.push({ severity, code, message, suggestion });
}

export function scoreFindings(findings) {
  let score = 100;
  for (const finding of findings) {
    score -= SEVERITY_WEIGHT[finding.severity] ?? 0;
  }
  return Math.max(0, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// Task-text checks
// ---------------------------------------------------------------------------

const PLACEHOLDER_PATTERNS = [
  { re: /\{\{[^{}]*\}\}/, label: "an unresolved {{ }} template tag" },
  { re: /<[A-Za-z][A-Za-z0-9 _-]*>/, label: "an unresolved <placeholder> tag" },
  { re: /\[insert\b[^\]]*\]/i, label: "an unresolved [insert ...] placeholder" },
  { re: /\bTODO\b/, label: "a TODO marker" },
  { re: /\bXXX\b/, label: "an XXX marker" },
  { re: /\bFIXME\b/, label: "a FIXME marker" },
  { re: /lorem ipsum/i, label: "lorem ipsum filler text" },
];

const SENSITIVE_DATA_PATTERNS = [
  /\bsocial security number\b/i,
  /\bssn\b/i,
  /\bcredit card\b/i,
  /\bcard number\b/i,
  /\bcvv\b/i,
  /\bpin\b/i,
  /\bpassword\b/i,
  /\bbank account number\b/i,
  /\bdate of birth\b/i,
  /\bmother'?s maiden name\b/i,
];

const INTENT_VERBS = ["ask", "confirm", "verify", "find out", "check whether", "collect", "determine"];

const CLOSING_PATTERNS = /\b(thank|end the call|hang up|goodbye|good-bye|that is all|that's all)\b/i;

const VOICEMAIL_PATTERNS = /\b(voicemail|voice mail|answering machine)\b/i;

const IDENTIFICATION_PATTERNS = [
  /\bthis is\b/i,
  /\bcalling from\b/i,
  /\bon behalf of\b/i,
  /\bi am calling about\b/i,
  /\bi'm calling about\b/i,
  /\btest call\b/i,
];

function findIntentVerbs(text) {
  const lower = text.toLowerCase();
  const found = new Set();
  for (const verb of INTENT_VERBS) {
    const re = new RegExp(`\\b${verb.replace(/ /g, "\\s+")}\\b`, "i");
    if (re.test(lower)) found.add(verb);
  }
  return found;
}

export function checkTask(taskText, findings) {
  if (taskText === undefined || taskText === null || taskText.trim() === "") {
    addFinding(
      findings,
      "error",
      "TASK_EMPTY",
      "The task text is missing or contains only whitespace.",
      "Write a task that states the goal, who is calling, and exactly what to collect."
    );
    return;
  }

  const trimmed = taskText.trim();

  if (trimmed.length < 40) {
    addFinding(
      findings,
      "error",
      "TASK_TOO_SHORT",
      `The task text is only ${trimmed.length} characters, too short to convey a goal plus what to collect.`,
      "Expand the task to include the goal, relevant context the agent should know, and the exact information to collect."
    );
  }

  if (trimmed.length > 1500) {
    addFinding(
      findings,
      "warning",
      "TASK_TOO_LONG",
      `The task text is ${trimmed.length} characters, over the ~1500 character guideline.`,
      "Trim the task to the goal, the single decision, and the essential edge cases; move background detail out."
    );
  }

  const placeholderHit = PLACEHOLDER_PATTERNS.find((pattern) => pattern.re.test(trimmed));
  if (placeholderHit) {
    addFinding(
      findings,
      "error",
      "TASK_PLACEHOLDER",
      `The task text contains ${placeholderHit.label}.`,
      "Replace every placeholder with the actual value before the call is placed."
    );
  }

  const sensitiveMatch = SENSITIVE_DATA_PATTERNS.map((pattern) => pattern.exec(trimmed)).find(Boolean);
  if (sensitiveMatch) {
    addFinding(
      findings,
      "error",
      "TASK_SENSITIVE_DATA",
      `The task text asks the agent to solicit sensitive data (matched "${sensitiveMatch[0]}").`,
      "Remove the request for this data. A phone agent must never collect SSNs, card numbers, CVVs, PINs, passwords, bank account numbers, dates of birth, or mother's maiden names."
    );
  }

  const hasIntentVerb = findIntentVerbs(trimmed).size > 0;
  const hasQuestionMark = trimmed.includes("?");
  if (!hasIntentVerb && !hasQuestionMark) {
    addFinding(
      findings,
      "error",
      "TASK_NO_EXPLICIT_ASK",
      "No discernible ask was found in the task text.",
      "State the ask explicitly, for example: \"Ask whether the appointment on Tuesday still works\" or \"Confirm the delivery address.\""
    );
  }

  if (!CLOSING_PATTERNS.test(trimmed)) {
    addFinding(
      findings,
      "warning",
      "TASK_NO_CLOSING",
      "No instruction on how to end the call was found.",
      "Add a closing instruction, for example: \"Thank them for their time and end the call.\""
    );
  }

  if (!VOICEMAIL_PATTERNS.test(trimmed)) {
    addFinding(
      findings,
      "warning",
      "TASK_NO_VOICEMAIL_GUIDANCE",
      "No instruction for voicemail or an answering machine was found.",
      "Add guidance for voicemail, for example: \"If you reach voicemail, leave a short message with a callback number and hang up.\""
    );
  }

  const opening = trimmed.slice(0, 200);
  const hasIdentification = IDENTIFICATION_PATTERNS.some((pattern) => pattern.test(opening));
  if (!hasIdentification) {
    addFinding(
      findings,
      "warning",
      "TASK_NO_IDENTIFICATION",
      "The opening of the task does not identify who is calling or why.",
      "Open with an identification line, for example: \"This is <company>, calling on behalf of <person> about <reason>.\""
    );
  }

  const lower = trimmed.toLowerCase();
  const hasJoiner = /\band also\b/.test(lower) || /\bthen also\b/.test(lower);
  const distinctVerbs = findIntentVerbs(trimmed);
  if (hasJoiner && distinctVerbs.size >= 3) {
    addFinding(
      findings,
      "warning",
      "TASK_MULTIPLE_GOALS",
      "The task appears to pursue several unrelated objectives joined with \"and also\" / \"then also\".",
      "Split this into one call with a single goal, or clearly rank the objectives so the agent knows what to do if time runs short."
    );
  }
}

// ---------------------------------------------------------------------------
// Result-schema checks
//
// The supported-keyword allowlist and structural rules mirror
// plugins/zapier-calle/lib/result-schema.js. This module does not import
// across directories, so the rules are re-implemented here to stand alone.
// ---------------------------------------------------------------------------

const SUPPORTED_KEYWORDS = new Set([
  "type",
  "properties",
  "required",
  "enum",
  "items",
  "description",
  "additionalProperties",
]);

const MAX_SCHEMA_DEPTH = 20;
const NESTING_INFO_THRESHOLD = 3;

const UNKNOWN_ENUM_TOKENS = new Set(["unknown", "unclear", "not_stated", "undetermined"]);

function normalizeToken(value) {
  return String(value).trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function hasUnknownEnumMember(enumValues) {
  return enumValues.some((value) => typeof value === "string" && UNKNOWN_ENUM_TOKENS.has(normalizeToken(value)));
}

function enumDescriptionHasGuidance(enumValues, description) {
  const lowerDesc = description.toLowerCase();
  return enumValues.some((value) => {
    if (typeof value !== "string") return false;
    const asIs = value.toLowerCase();
    const spaced = asIs.replace(/_/g, " ");
    return lowerDesc.includes(asIs) || lowerDesc.includes(spaced);
  });
}

function walkSchema(node, path, depth, findings, context) {
  if (depth > MAX_SCHEMA_DEPTH) {
    addFinding(
      findings,
      "error",
      "SCHEMA_MALFORMED",
      `The schema exceeds the maximum nesting depth of ${MAX_SCHEMA_DEPTH} (at ${path}).`,
      "Flatten the schema; CALL-E's extraction model cannot reliably fill deeply nested structures."
    );
    return;
  }

  if (!node || typeof node !== "object" || Array.isArray(node)) {
    addFinding(
      findings,
      "error",
      "SCHEMA_MALFORMED",
      `Schema node must be a JSON object (at ${path}).`,
      "Make sure every schema node, property, and items entry is a JSON object."
    );
    return;
  }

  for (const key of Object.keys(node)) {
    if (!SUPPORTED_KEYWORDS.has(key)) {
      addFinding(
        findings,
        "error",
        "SCHEMA_UNSUPPORTED_KEYWORD",
        `CALL-E does not support "${key}" in result schemas (at ${path}).`,
        `Remove "${key}". Supported keywords are: ${[...SUPPORTED_KEYWORDS].join(", ")}.`
      );
    }
  }

  if (depth > NESTING_INFO_THRESHOLD && !context.reportedDeepNesting) {
    context.reportedDeepNesting = true;
    addFinding(
      findings,
      "info",
      "SCHEMA_DEEPLY_NESTED",
      `The schema nests beyond ${NESTING_INFO_THRESHOLD} levels (at ${path}).`,
      "Flatten fields where possible; extraction reliability drops with deep nesting."
    );
  }

  if ("additionalProperties" in node && node.additionalProperties !== false) {
    addFinding(
      findings,
      "error",
      "SCHEMA_ADDITIONAL_PROPERTIES",
      `"additionalProperties" must be the boolean false (at ${path}).`,
      'Set "additionalProperties": false.'
    );
  }

  if ("required" in node) {
    const required = node.required;
    if (!Array.isArray(required) || !required.every((entry) => typeof entry === "string")) {
      addFinding(
        findings,
        "error",
        "SCHEMA_MALFORMED",
        `"required" must be an array of strings (at ${path}).`,
        'Set "required" to an array of property-name strings, for example ["status"].'
      );
    } else if (depth === 1 && required.length === 0) {
      addFinding(
        findings,
        "warning",
        "SCHEMA_NO_REQUIRED",
        "The root schema has an empty \"required\" array, so nothing is guaranteed on the result.",
        "List the property names the call must always resolve, for example [\"outcome\"]."
      );
    }
  } else if (depth === 1) {
    addFinding(
      findings,
      "warning",
      "SCHEMA_NO_REQUIRED",
      'The root schema has no "required" array, so nothing is guaranteed on the result.',
      "Add a \"required\" array listing the property names the call must always resolve."
    );
  }

  if ("enum" in node && !Array.isArray(node.enum)) {
    addFinding(
      findings,
      "error",
      "SCHEMA_MALFORMED",
      `"enum" must be an array (at ${path}).`,
      "Set \"enum\" to an array of allowed string values."
    );
  }

  if ("description" in node && typeof node.description !== "string") {
    addFinding(
      findings,
      "error",
      "SCHEMA_MALFORMED",
      `"description" must be a string (at ${path}).`,
      "Set \"description\" to a plain string explaining the field's meaning."
    );
  }

  if ("properties" in node) {
    if (!node.properties || typeof node.properties !== "object" || Array.isArray(node.properties)) {
      addFinding(
        findings,
        "error",
        "SCHEMA_MALFORMED",
        `"properties" must be an object (at ${path}).`,
        'Set "properties" to an object mapping field names to field schemas.'
      );
    } else {
      for (const [fieldName, fieldSchema] of Object.entries(node.properties)) {
        checkField(fieldName, fieldSchema, `${path}.properties.${fieldName}`, findings);
        walkSchema(fieldSchema, `${path}.properties.${fieldName}`, depth + 1, findings, context);
      }
    }
  }

  if ("items" in node) {
    walkSchema(node.items, `${path}.items`, depth + 1, findings, context);
  }
}

function checkField(fieldName, fieldSchema, path, findings) {
  if (!fieldSchema || typeof fieldSchema !== "object" || Array.isArray(fieldSchema)) {
    return;
  }

  if (typeof fieldSchema.description !== "string" || fieldSchema.description.trim() === "") {
    addFinding(
      findings,
      "warning",
      "SCHEMA_FIELD_NO_DESCRIPTION",
      `Property "${fieldName}" has no description (at ${path}).`,
      "Add a description explaining what this field means and, for enums, how to choose between values."
    );
  }

  if (fieldSchema.type === "boolean") {
    addFinding(
      findings,
      "warning",
      "SCHEMA_BOOLEAN_FOR_DECISION",
      `Property "${fieldName}" is a boolean (at ${path}).`,
      "Prefer a string enum for business decisions that may be unclear, and include an \"unknown\" value."
    );
  }

  if (Array.isArray(fieldSchema.enum)) {
    if (!hasUnknownEnumMember(fieldSchema.enum)) {
      addFinding(
        findings,
        "warning",
        "SCHEMA_ENUM_NO_UNKNOWN",
        `Enum property "${fieldName}" has no unknown-like member (at ${path}).`,
        'Add an "unknown" (or "unclear" / "not_stated" / "undetermined") value for calls that do not provide enough evidence.'
      );
    }

    if (
      typeof fieldSchema.description === "string" &&
      fieldSchema.description.trim() !== "" &&
      !enumDescriptionHasGuidance(fieldSchema.enum, fieldSchema.description)
    ) {
      addFinding(
        findings,
        "warning",
        "SCHEMA_ENUM_DESCRIPTION_NO_GUIDANCE",
        `The description for enum property "${fieldName}" does not explain how to choose between its values (at ${path}).`,
        'Explain the selection logic, for example: "Use strong when the prospect asks about pricing, demos, or next steps."'
      );
    }
  }
}

export function checkSchema(schemaText, findings) {
  let candidate;
  try {
    candidate = JSON.parse(schemaText);
  } catch {
    addFinding(
      findings,
      "error",
      "SCHEMA_INVALID_JSON",
      "The result schema is not valid JSON.",
      "Fix the JSON syntax error and re-run the linter."
    );
    return;
  }

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    addFinding(
      findings,
      "error",
      "SCHEMA_ROOT_NOT_OBJECT",
      "The result schema root must be a JSON object.",
      'Wrap the schema in an object with "type": "object" and a "properties" map.'
    );
    return;
  }

  if (candidate.type !== "object") {
    addFinding(
      findings,
      "error",
      "SCHEMA_ROOT_NOT_OBJECT",
      `The result schema root "type" must be "object" (got ${JSON.stringify(candidate.type)}).`,
      'Set the root "type" to "object".'
    );
  }

  const context = { reportedDeepNesting: false };
  walkSchema(candidate, "schema", 1, findings, context);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    const next = argv[i + 1];
    switch (arg) {
      case "--task":
        result.task = next;
        i += 1;
        break;
      case "--task-file":
        result.taskFile = next;
        i += 1;
        break;
      case "--schema":
        result.schema = next;
        i += 1;
        break;
      case "--schema-file":
        result.schemaFile = next;
        i += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return result;
}

function resolveInputs(parsed) {
  if (parsed.task !== undefined && parsed.taskFile !== undefined) {
    throw new Error("Use either --task or --task-file, not both.");
  }
  if (parsed.schema !== undefined && parsed.schemaFile !== undefined) {
    throw new Error("Use either --schema or --schema-file, not both.");
  }

  const taskText = parsed.taskFile !== undefined ? fs.readFileSync(parsed.taskFile, "utf8") : parsed.task;
  const schemaText =
    parsed.schemaFile !== undefined ? fs.readFileSync(parsed.schemaFile, "utf8") : parsed.schema;

  return { taskText, schemaText };
}

const SEVERITY_ORDER = ["error", "warning", "info"];
const SEVERITY_LABEL = { error: "ERROR", warning: "WARNING", info: "INFO" };

export function formatReport(findings, score) {
  const lines = [];
  for (const severity of SEVERITY_ORDER) {
    const group = findings.filter((finding) => finding.severity === severity);
    if (group.length === 0) continue;
    lines.push(`${SEVERITY_LABEL[severity]}S:`);
    for (const finding of group) {
      lines.push(`  [${finding.code}] ${finding.message}`);
      lines.push(`    suggestion: ${finding.suggestion}`);
    }
  }

  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  const warningCount = findings.filter((finding) => finding.severity === "warning").length;
  const infoCount = findings.filter((finding) => finding.severity === "info").length;

  lines.push(
    `SUMMARY: ${errorCount} error(s), ${warningCount} warning(s), ${infoCount} info finding(s), score ${score}/100`
  );

  return lines.join("\n");
}

function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(HELP);
    process.exit(2);
  }

  if (parsed.help) {
    process.stdout.write(HELP);
    return;
  }

  if (
    parsed.task === undefined &&
    parsed.taskFile === undefined &&
    parsed.schema === undefined &&
    parsed.schemaFile === undefined
  ) {
    console.error("Nothing to check: pass --task/--task-file and/or --schema/--schema-file.");
    console.error(HELP);
    process.exit(2);
  }

  let taskText;
  let schemaText;
  try {
    ({ taskText, schemaText } = resolveInputs(parsed));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  const findings = [];
  if (taskText !== undefined) {
    checkTask(taskText, findings);
  }
  if (schemaText !== undefined) {
    checkSchema(schemaText, findings);
  }

  const score = scoreFindings(findings);
  console.log(formatReport(findings, score));

  const hasError = findings.some((finding) => finding.severity === "error");
  process.exit(hasError ? 1 : 0);
}

const executedPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;
if (executedPath) {
  main();
}
