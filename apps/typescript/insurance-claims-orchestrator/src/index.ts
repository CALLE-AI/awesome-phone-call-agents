// src/index.ts
// Entry point for the insurance claims orchestrator.
//
// Usage:
//   npx tsx src/index.ts --phone +15550001234         (DRY-RUN)
//   npx tsx src/index.ts --phone +15550001234 --live  (LIVE, requires CALLE_API_KEY)

import { ClaimChain } from "./ClaimChain.js";
import { buildLossReportStep } from "./call1-loss-report.js";
import { buildCoverageVerifyStep } from "./call2-coverage-verify.js";
import { calleApiCaller } from "./poller.js";
import type { CallOutcome } from "./ClaimChain.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const phoneIdx = args.indexOf("--phone");
  const phone = phoneIdx >= 0 ? args[phoneIdx + 1] : null;
  const live = args.includes("--live");

  if (!phone) {
    console.error("Usage: tsx src/index.ts --phone +1XXXXXXXXXX [--live]");
    process.exit(1);
  }

  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    console.error("Phone must be E.164 format, e.g. +15550001234");
    process.exit(1);
  }

  if (live && !process.env.CALLE_API_KEY) {
    console.error("CALLE_API_KEY environment variable is required for --live mode");
    process.exit(1);
  }

  const masked = phone.slice(0, 4) + "*".repeat(Math.max(0, phone.length - 4));
  console.log("\n=== Insurance Claims Orchestrator ===");
  console.log(`Mode:  ${live ? "LIVE (calls will be placed)" : "DRY-RUN (no calls placed)"}`);
  console.log(`Phone: ${masked}\n`);

  const chain = new ClaimChain()
    .addStep(buildLossReportStep())
    .addStep(buildCoverageVerifyStep());

  const noop = async (): Promise<{
    callId: string;
    outcome: CallOutcome;
    structured_result: object | null;
  }> => ({ callId: "", outcome: "completed", structured_result: null });

  const caller = live ? calleApiCaller : noop;
  const result = await chain.execute(phone, caller, !live);

  console.log("\n=== Result ===");
  console.log(JSON.stringify(result, null, 2));

  if (result.humanReviewRequired) {
    console.log("\n⚠️  HUMAN REVIEW REQUIRED:", result.humanReviewReason);
    process.exit(2);
  }

  console.log("\n✅ Both calls completed. Routing to adjuster assignment queue.");
}

main().catch((e: Error) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
