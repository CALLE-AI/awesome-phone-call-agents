import assert from "node:assert/strict";
import { test } from "node:test";

import { checkTask, checkSchema, scoreFindings } from "./check-call-script.mjs";

// A canonical known-good task and schema. This fixture must produce zero
// errors and a high score, and doubles as the worked example other
// references/examples.md fixtures are modeled on.
const GOOD_TASK =
  "This is Riverside Dental, calling on behalf of Dr. Alvarez's office about your upcoming appointment. " +
  "Please confirm whether Tuesday at 2pm still works for you, or ask to reschedule if not. " +
  "If you reach voicemail, leave a short message asking them to call the office back. " +
  "Thank them for their time and end the call.";

const GOOD_SCHEMA = JSON.stringify({
  type: "object",
  additionalProperties: false,
  required: ["confirmation_status"],
  properties: {
    confirmation_status: {
      type: "string",
      description:
        "Use confirmed when the patient confirms Tuesday at 2pm, use reschedule_requested when they ask for a new time, and use unknown when the call did not reach a clear answer.",
      enum: ["confirmed", "reschedule_requested", "unknown"],
    },
  },
});

function codes(findings) {
  return findings.map((finding) => finding.code);
}

function findingsFor(taskText) {
  const findings = [];
  checkTask(taskText, findings);
  return findings;
}

function schemaFindingsFor(schemaText) {
  const findings = [];
  checkSchema(schemaText, findings);
  return findings;
}

test("known-good task and schema produce zero errors and a high score", () => {
  const findings = [];
  checkTask(GOOD_TASK, findings);
  checkSchema(GOOD_SCHEMA, findings);
  const errors = findings.filter((finding) => finding.severity === "error");
  assert.equal(errors.length, 0, JSON.stringify(findings, null, 2));
  const score = scoreFindings(findings);
  assert.ok(score >= 90, `expected a high score, got ${score}`);
});

test("every finding has a code, severity, message, and suggestion", () => {
  const findings = [];
  checkTask("", findings);
  checkSchema("not json", findings);
  for (const finding of findings) {
    assert.ok(finding.severity, "missing severity");
    assert.ok(finding.code, "missing code");
    assert.ok(finding.message, "missing message");
    assert.ok(finding.suggestion, "missing suggestion");
  }
});

// --- Task checks -----------------------------------------------------------

test("TASK_EMPTY fires for missing or whitespace-only task", () => {
  assert.ok(codes(findingsFor("")).includes("TASK_EMPTY"));
  assert.ok(codes(findingsFor("   \n  ")).includes("TASK_EMPTY"));
  assert.ok(!codes(findingsFor(GOOD_TASK)).includes("TASK_EMPTY"));
});

test("TASK_TOO_SHORT fires under ~40 characters", () => {
  assert.ok(codes(findingsFor("Ask about the thing.")).includes("TASK_TOO_SHORT"));
  assert.ok(!codes(findingsFor(GOOD_TASK)).includes("TASK_TOO_SHORT"));
});

test("TASK_TOO_LONG fires over ~1500 characters", () => {
  const longTask = `${GOOD_TASK} ${"filler detail sentence. ".repeat(80)}`;
  assert.ok(longTask.length > 1500);
  assert.ok(codes(findingsFor(longTask)).includes("TASK_TOO_LONG"));
  assert.ok(!codes(findingsFor(GOOD_TASK)).includes("TASK_TOO_LONG"));
});

test("TASK_PLACEHOLDER fires for unresolved templating", () => {
  assert.ok(codes(findingsFor(`${GOOD_TASK} {{customer_name}}`)).includes("TASK_PLACEHOLDER"));
  assert.ok(codes(findingsFor(`${GOOD_TASK} <customer name>`)).includes("TASK_PLACEHOLDER"));
  assert.ok(codes(findingsFor(`${GOOD_TASK} [insert name here]`)).includes("TASK_PLACEHOLDER"));
  assert.ok(codes(findingsFor(`${GOOD_TASK} TODO add details`)).includes("TASK_PLACEHOLDER"));
  assert.ok(codes(findingsFor(`${GOOD_TASK} lorem ipsum dolor`)).includes("TASK_PLACEHOLDER"));
  assert.ok(!codes(findingsFor(GOOD_TASK)).includes("TASK_PLACEHOLDER"));
});

test("TASK_SENSITIVE_DATA fires for data a phone agent must not collect", () => {
  assert.ok(
    codes(findingsFor(`${GOOD_TASK} Ask for their social security number.`)).includes("TASK_SENSITIVE_DATA")
  );
  assert.ok(codes(findingsFor(`${GOOD_TASK} Confirm the credit card number.`)).includes("TASK_SENSITIVE_DATA"));
  assert.ok(codes(findingsFor(`${GOOD_TASK} Ask for their PIN.`)).includes("TASK_SENSITIVE_DATA"));
  assert.ok(!codes(findingsFor(GOOD_TASK)).includes("TASK_SENSITIVE_DATA"));
});

test("TASK_NO_EXPLICIT_ASK fires when there is no intent verb or question mark", () => {
  const noAsk =
    "This is Acme calling on behalf of the front desk about your recent visit to the clinic downtown today.";
  assert.ok(codes(findingsFor(noAsk)).includes("TASK_NO_EXPLICIT_ASK"));
  assert.ok(!codes(findingsFor(GOOD_TASK)).includes("TASK_NO_EXPLICIT_ASK"));
});

test("TASK_NO_CLOSING fires when there is no instruction to end the call", () => {
  const noClosing =
    "This is Acme calling on behalf of the clinic. Please confirm whether Tuesday at 2pm still works.";
  assert.ok(codes(findingsFor(noClosing)).includes("TASK_NO_CLOSING"));
  assert.ok(!codes(findingsFor(GOOD_TASK)).includes("TASK_NO_CLOSING"));
});

test("TASK_NO_VOICEMAIL_GUIDANCE fires when there is no voicemail instruction", () => {
  const noVoicemail =
    "This is Acme calling on behalf of the clinic. Please confirm Tuesday at 2pm. Thank them and end the call.";
  assert.ok(codes(findingsFor(noVoicemail)).includes("TASK_NO_VOICEMAIL_GUIDANCE"));
  assert.ok(!codes(findingsFor(GOOD_TASK)).includes("TASK_NO_VOICEMAIL_GUIDANCE"));
});

test("TASK_NO_IDENTIFICATION fires when the opening does not identify the caller", () => {
  const noId =
    "Please confirm whether Tuesday at 2pm still works for the appointment. If voicemail, leave a message. Thank them and end the call.";
  assert.ok(codes(findingsFor(noId)).includes("TASK_NO_IDENTIFICATION"));
  assert.ok(!codes(findingsFor(GOOD_TASK)).includes("TASK_NO_IDENTIFICATION"));
});

test("TASK_MULTIPLE_GOALS fires for several objectives joined with and also / then also", () => {
  const multiGoal =
    "This is Acme calling. Please ask about the invoice status and also confirm the shipping address " +
    "and also collect the preferred callback time, then thank them and end the call. " +
    "If voicemail, leave a message.";
  assert.ok(codes(findingsFor(multiGoal)).includes("TASK_MULTIPLE_GOALS"));
  assert.ok(!codes(findingsFor(GOOD_TASK)).includes("TASK_MULTIPLE_GOALS"));
});

test("TASK_MULTIPLE_GOALS does not fire on an ordinary task with one goal", () => {
  // Guards against false positives: a single ask, phrased naturally, must stay quiet.
  assert.ok(!codes(findingsFor(GOOD_TASK)).includes("TASK_MULTIPLE_GOALS"));
});

// --- Schema checks -----------------------------------------------------------

test("SCHEMA_INVALID_JSON fires for unparseable JSON", () => {
  assert.ok(codes(schemaFindingsFor("{not json")).includes("SCHEMA_INVALID_JSON"));
  assert.ok(!codes(schemaFindingsFor(GOOD_SCHEMA)).includes("SCHEMA_INVALID_JSON"));
});

test("SCHEMA_UNSUPPORTED_KEYWORD fires for keys outside the supported allowlist", () => {
  const schema = JSON.stringify({ type: "object", minLength: 3, properties: {} });
  assert.ok(codes(schemaFindingsFor(schema)).includes("SCHEMA_UNSUPPORTED_KEYWORD"));
  assert.ok(!codes(schemaFindingsFor(GOOD_SCHEMA)).includes("SCHEMA_UNSUPPORTED_KEYWORD"));
});

test("SCHEMA_ROOT_NOT_OBJECT fires when the root type is not object", () => {
  assert.ok(codes(schemaFindingsFor(JSON.stringify({ type: "string" }))).includes("SCHEMA_ROOT_NOT_OBJECT"));
  assert.ok(codes(schemaFindingsFor(JSON.stringify(["not", "an", "object"]))).includes("SCHEMA_ROOT_NOT_OBJECT"));
  assert.ok(!codes(schemaFindingsFor(GOOD_SCHEMA)).includes("SCHEMA_ROOT_NOT_OBJECT"));
});

test("SCHEMA_ADDITIONAL_PROPERTIES fires unless additionalProperties is exactly false", () => {
  const schema = JSON.stringify({ type: "object", additionalProperties: true, properties: {} });
  assert.ok(codes(schemaFindingsFor(schema)).includes("SCHEMA_ADDITIONAL_PROPERTIES"));
  assert.ok(!codes(schemaFindingsFor(GOOD_SCHEMA)).includes("SCHEMA_ADDITIONAL_PROPERTIES"));
});

test("SCHEMA_NO_REQUIRED fires when required is missing or empty", () => {
  const missing = JSON.stringify({ type: "object", additionalProperties: false, properties: {} });
  const empty = JSON.stringify({ type: "object", additionalProperties: false, required: [], properties: {} });
  assert.ok(codes(schemaFindingsFor(missing)).includes("SCHEMA_NO_REQUIRED"));
  assert.ok(codes(schemaFindingsFor(empty)).includes("SCHEMA_NO_REQUIRED"));
  assert.ok(!codes(schemaFindingsFor(GOOD_SCHEMA)).includes("SCHEMA_NO_REQUIRED"));
});

test("SCHEMA_FIELD_NO_DESCRIPTION fires when a property has no description", () => {
  const schema = JSON.stringify({
    type: "object",
    required: ["status"],
    properties: { status: { type: "string", enum: ["yes", "no"] } },
  });
  assert.ok(codes(schemaFindingsFor(schema)).includes("SCHEMA_FIELD_NO_DESCRIPTION"));
  assert.ok(!codes(schemaFindingsFor(GOOD_SCHEMA)).includes("SCHEMA_FIELD_NO_DESCRIPTION"));
});

test("SCHEMA_ENUM_NO_UNKNOWN fires when a string enum has no unknown-like member", () => {
  const schema = JSON.stringify({
    type: "object",
    required: ["status"],
    properties: { status: { type: "string", description: "The outcome.", enum: ["yes", "no"] } },
  });
  assert.ok(codes(schemaFindingsFor(schema)).includes("SCHEMA_ENUM_NO_UNKNOWN"));
  assert.ok(!codes(schemaFindingsFor(GOOD_SCHEMA)).includes("SCHEMA_ENUM_NO_UNKNOWN"));
});

test("SCHEMA_ENUM_DESCRIPTION_NO_GUIDANCE fires when the description omits the enum values", () => {
  const schema = JSON.stringify({
    type: "object",
    required: ["status"],
    properties: {
      status: {
        type: "string",
        description: "The outcome of the call.",
        enum: ["confirmed", "unknown"],
      },
    },
  });
  assert.ok(codes(schemaFindingsFor(schema)).includes("SCHEMA_ENUM_DESCRIPTION_NO_GUIDANCE"));
  assert.ok(!codes(schemaFindingsFor(GOOD_SCHEMA)).includes("SCHEMA_ENUM_DESCRIPTION_NO_GUIDANCE"));
});

test("SCHEMA_BOOLEAN_FOR_DECISION fires for boolean properties", () => {
  const schema = JSON.stringify({
    type: "object",
    required: ["confirmed"],
    properties: { confirmed: { type: "boolean", description: "Whether they confirmed." } },
  });
  assert.ok(codes(schemaFindingsFor(schema)).includes("SCHEMA_BOOLEAN_FOR_DECISION"));
  assert.ok(!codes(schemaFindingsFor(GOOD_SCHEMA)).includes("SCHEMA_BOOLEAN_FOR_DECISION"));
});

test("SCHEMA_DEEPLY_NESTED fires beyond about three levels of nesting", () => {
  const deep = JSON.stringify({
    type: "object",
    properties: {
      a: {
        type: "object",
        properties: {
          b: {
            type: "object",
            properties: {
              c: { type: "object", properties: { d: { type: "string", description: "x" } } },
            },
          },
        },
      },
    },
  });
  assert.ok(codes(schemaFindingsFor(deep)).includes("SCHEMA_DEEPLY_NESTED"));
  assert.ok(!codes(schemaFindingsFor(GOOD_SCHEMA)).includes("SCHEMA_DEEPLY_NESTED"));
});

// --- Scoring -----------------------------------------------------------

test("scoreFindings starts at 100 and floors at 0", () => {
  assert.equal(scoreFindings([]), 100);
  const manyErrors = Array.from({ length: 20 }, () => ({ severity: "error" }));
  assert.equal(scoreFindings(manyErrors), 0);
});

test("scoreFindings subtracts more for errors than warnings", () => {
  const oneError = scoreFindings([{ severity: "error" }]);
  const oneWarning = scoreFindings([{ severity: "warning" }]);
  assert.ok(oneError < oneWarning);
});
