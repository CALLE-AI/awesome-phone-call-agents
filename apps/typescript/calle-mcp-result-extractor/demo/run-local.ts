import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AppointmentConfirmationResult,
  EXPECTED_RESULT,
  QUESTIONS_TO_RESOLVE,
} from "../examples/appointment-confirmation.js";
import { DEFAULT_EXTRACTION_SYSTEM_PROMPT, extractStructuredResult } from "../src/extract-from-transcript.js";
import { FakeReasoningProvider } from "../src/reasoning/fake.js";

/**
 * Runs the whole extraction pipeline with zero credentials and zero network
 * calls: a canned CALL-E call-run result stands in for a real one, and a
 * deterministic fake reasoning provider stands in for Bedrock. This is what
 * "no live credentials, no real outbound calls, dry-run by default" looks
 * like end to end — `npm run demo`.
 */
async function main() {
  const fixturePath = fileURLToPath(new URL("../fake/sample-call-run.json", import.meta.url));
  const callRun = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    status: string;
    result: { transcript: string };
  };

  if (callRun.status !== "COMPLETED" || !callRun.result.transcript) {
    throw new Error("Fixture is not a completed call with a transcript.");
  }

  const reasoning = new FakeReasoningProvider().register(
    "appointment-confirmation",
    EXPECTED_RESULT,
  );

  const result = await extractStructuredResult(reasoning, {
    task: "appointment-confirmation",
    systemPrompt: DEFAULT_EXTRACTION_SYSTEM_PROMPT,
    transcript: callRun.result.transcript,
    questionsToResolve: QUESTIONS_TO_RESOLVE,
    schema: AppointmentConfirmationResult,
  });

  console.log("Structured result (schema-validated, zero credentials used):");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
