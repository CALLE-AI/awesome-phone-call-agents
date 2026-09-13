import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  AppointmentConfirmationResult,
  EXPECTED_RESULT,
  QUESTIONS_TO_RESOLVE,
} from "../examples/appointment-confirmation.js";
import { DEFAULT_EXTRACTION_SYSTEM_PROMPT, extractStructuredResult } from "../src/extract-from-transcript.js";
import { FakeReasoningProvider } from "../src/reasoning/fake.js";
import { ReasoningValidationError } from "../src/reasoning/types.js";

const FIXTURE_PATH = fileURLToPath(new URL("../fake/sample-call-run.json", import.meta.url));

function loadTranscript(): string {
  const callRun = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
    result: { transcript: string };
  };
  return callRun.result.transcript;
}

test("extracts a schema-valid result from the bundled fake transcript, no credentials", async () => {
  const reasoning = new FakeReasoningProvider().register(
    "appointment-confirmation",
    EXPECTED_RESULT,
  );

  const result = await extractStructuredResult(reasoning, {
    task: "appointment-confirmation",
    systemPrompt: DEFAULT_EXTRACTION_SYSTEM_PROMPT,
    transcript: loadTranscript(),
    questionsToResolve: QUESTIONS_TO_RESOLVE,
    schema: AppointmentConfirmationResult,
  });

  assert.deepEqual(result, EXPECTED_RESULT);
});

test("fake provider rejects a response that does not satisfy the schema", async () => {
  const reasoning = new FakeReasoningProvider().register("appointment-confirmation", {
    appointmentConfirmed: "yes", // wrong type — should be boolean
  });

  await assert.rejects(
    extractStructuredResult(reasoning, {
      task: "appointment-confirmation",
      systemPrompt: DEFAULT_EXTRACTION_SYSTEM_PROMPT,
      transcript: loadTranscript(),
      questionsToResolve: QUESTIONS_TO_RESOLVE,
      schema: AppointmentConfirmationResult,
    }),
    ReasoningValidationError,
  );
});

test("fake provider fails clearly when no response was registered for the task", async () => {
  const reasoning = new FakeReasoningProvider();

  await assert.rejects(
    extractStructuredResult(reasoning, {
      task: "appointment-confirmation",
      systemPrompt: DEFAULT_EXTRACTION_SYSTEM_PROMPT,
      transcript: loadTranscript(),
      questionsToResolve: QUESTIONS_TO_RESOLVE,
      schema: AppointmentConfirmationResult,
    }),
    /No fake response registered/,
  );
});
