// scripts/dry-run.ts
// Runs the full two-call sequence against fixture data.
// NO calls are placed. No CALLE_API_KEY needed.
//
// Usage (from app root):
//   npm run dry-run

import { createRequire } from "node:module";
import { ClaimChain } from "../src/ClaimChain.js";
import { buildLossReportStep } from "../src/call1-loss-report.js";
import { buildCoverageVerifyStep } from "../src/call2-coverage-verify.js";
import type { CallOutcome } from "../src/ClaimChain.js";

const require = createRequire(import.meta.url);
const lossFixture = require("./fixtures/loss-report-result.json");
const coverageFixture = require("./fixtures/coverage-verify-result.json");

async function runDryRun(): Promise<void> {
  console.log("=== DRY-RUN: Insurance Claims Orchestrator ===\n");

  const chain = new ClaimChain()
    .addStep(buildLossReportStep())
    .addStep(buildCoverageVerifyStep());

  let callCount = 0;
  const fixtures = [lossFixture, coverageFixture];

  const mockCaller = async (
    _phone: string,
    task: string,
    _schema: object
  ): Promise<{ callId: string; outcome: CallOutcome; structured_result: object | null }> => {
    const fixture = fixtures[callCount++];
    console.log(`\n--- Simulating Call ${callCount} (${fixture.call_id}) ---`);
    console.log("Task sent to CALL-E (first 300 chars):");
    console.log(task.slice(0, 300) + "...\n");
    console.log("Fixture result:", JSON.stringify(fixture.structured_result, null, 2));
    return {
      callId: fixture.call_id,
      outcome: fixture.outcome as CallOutcome,
      structured_result: fixture.structured_result,
    };
  };

  const result = await chain.execute("+15550001234", mockCaller, false);

  console.log("\n=== ORCHESTRATION RESULT ===");
  console.log(JSON.stringify(result, null, 2));
  console.log(
    result.completed
      ? "\n✅ SUCCESS — Route to adjuster queue."
      : "\n⚠️  Human review required: " + result.humanReviewReason
  );
}

runDryRun().catch((e: Error) => {
  console.error("Dry-run error:", e.message);
  process.exit(1);
});
