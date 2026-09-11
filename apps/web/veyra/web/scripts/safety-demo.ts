import assert from "node:assert/strict";

import { executeApprovedCall } from "../lib/calle/client";
import { createCallPreview, parseCallDraft } from "../lib/calle/safety";

process.env.CALL_MODE = "fake";

const draft = parseCallDraft({
  // 555-0100 through 555-0199 are reserved for fictional use in the NANP.
  phone: "+14155550100",
  locale: "en-IN",
  task:
    "Identify yourself as an AI assistant, ask for permission to continue, stop if permission is declined, and record whether an adviser follow-up is wanted.",
  resultSchema: {
    type: "object",
    properties: {
      consented: { type: "boolean" },
      next_step: {
        type: "string",
        enum: ["adviser_follow_up", "no_follow_up", "opted_out"],
      },
    },
    required: ["consented", "next_step"],
    additionalProperties: false,
  },
  metadata: { source: "credential-free-safety-demo" },
});

async function main(): Promise<void> {
  const preview = await createCallPreview("local-demo-user", draft, "fake");
  const execution = await executeApprovedCall(draft, preview);

  assert.equal(execution.externalSideEffect, false);
  assert.equal(execution.mode, "fake");

  console.log(
    JSON.stringify(
      {
        mode: execution.mode,
        maskedRecipient: preview.maskedPhone,
        callCount: preview.callCount,
        sideEffects: preview.sideEffects,
        approvalReference: `${preview.approvalDigest.slice(0, 12)}…`,
        result: execution.structuredResult,
        realCallsPlaced: 0,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Safety demo failed");
  process.exitCode = 1;
});
