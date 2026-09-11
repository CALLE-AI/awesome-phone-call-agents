// Phase 0 smoke test: one real end-to-end CALL-E call to YOUR OWN phone.
// Requires CALLE_DRY_RUN=false, CALLE_API_KEY, and LIVE_CALL_OVERRIDE_PHONE
// in the environment. This spends 1 of the 20 free-tier calls — run it once.

import { env, assertLiveCallAllowed } from "../src/config/env.js";
import { prisma } from "../src/db/client.js";
import { runCall, mask } from "../src/calle/client.js";

async function main(): Promise<void> {
  if (env.CALLE_DRY_RUN) {
    console.log("CALLE_DRY_RUN=true — this will only record a mock. Set CALLE_DRY_RUN=false for the real smoke test.");
  } else {
    assertLiveCallAllowed();
    console.log(`Placing ONE real call to ${mask(env.LIVE_CALL_OVERRIDE_PHONE)} ...`);
  }

  const business =
    (await prisma.business.findFirst()) ??
    (await prisma.business.create({
      data: { name: "AI Front Desk Smoke Test", timezone: "UTC", phone: "+15550100000", businessType: "CLINIC" },
    }));

  const result = await runCall({
    flow: "HELLO_WORLD",
    businessId: business.id,
    phone: env.LIVE_CALL_OVERRIDE_PHONE || "+15550100999",
    task:
      "This is a test call from the AI Front Desk demo app. Greet the person, say this is a one-time integration test, " +
      "ask them if they can hear you clearly, thank them, and end the call.",
    resultSchema: {
      type: "object",
      required: ["heard_clearly"],
      additionalProperties: false,
      properties: {
        heard_clearly: { type: "string", enum: ["yes", "no", "unknown"] },
      },
    },
    dryRunResult: { heard_clearly: "yes" },
    idempotencyKey: `hello_world_${Date.now()}`,
  });

  console.log("Result:", JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
