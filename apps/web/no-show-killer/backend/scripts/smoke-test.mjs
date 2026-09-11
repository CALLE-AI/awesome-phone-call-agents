#!/usr/bin/env node
// Manual verification path (no test framework dependency needed): starts a
// dry-run confirmation "call" for a fictional appointment and checks that
// the fields the rest of the app relies on come back in the expected shape.
// No real call is placed - this only exercises the DRY_RUN path in calle.js.
//
// Run with: npm test   (from backend/)

import { startCall, callStatus } from "../calle.js";

// Reserved fictional NANP sample number (555-01xx is never assigned to a
// real subscriber) - safe to use in public code and docs.
const SAMPLE_PHONE = "+12025550142";

async function main() {
  if (process.env.DRY_RUN === "false") {
    console.error(
      "Refusing to run the smoke test with DRY_RUN=false - that would attempt a real call. " +
        "Unset DRY_RUN or set it to true to run this check."
    );
    process.exit(1);
  }

  const started = await startCall({
    toPhone: SAMPLE_PHONE,
    goal: "Smoke test - confirm a fictional appointment.",
  });

  const startedStatus = started?.status_result?.structuredContent;
  const startOk =
    started?.ok === true &&
    typeof started.run_id === "string" &&
    startedStatus?.status === "COMPLETED";

  if (!startOk) {
    console.error("Smoke test FAILED on startCall() - unexpected shape:", JSON.stringify(started, null, 2));
    process.exit(1);
  }

  const polled = await callStatus({ runId: started.run_id });
  const polledOk = polled?.ok === true && polled.result?.structuredContent?.status === "COMPLETED";

  if (!polledOk) {
    console.error("Smoke test FAILED on callStatus() - unexpected shape:", JSON.stringify(polled, null, 2));
    process.exit(1);
  }

  console.log("Smoke test passed: dry-run startCall() + callStatus() both returned the expected shape.");
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
