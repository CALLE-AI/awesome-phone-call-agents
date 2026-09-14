/**
 * Auth / wiring smoke test. Defaults to the local simulator.
 * A live dial requires CALLE_LIVE=1, a real API key, and an explicit phone.
 *
 * Usage:
 *   pnpm smoke
 *   CALLE_LIVE=1 CALLE_API_KEY=... CALLE_SMOKE_PHONE=+1... pnpm smoke
 */

import { createCalleClient, resolveCalleBaseUrl, resolveCalleMode } from "./client";

const task =
  "Call this number and say you are an automated AI assistant running a connectivity smoke test. Ask whether the person can hear you clearly. Do not collect any personal information. If you reach voicemail, leave no message and end.";

async function main() {
  const mode = resolveCalleMode();
  const baseUrl = resolveCalleBaseUrl();
  const phone = process.env.CALLE_SMOKE_PHONE ?? "+15555550100";

  console.log(`[smoke] mode=${mode} baseUrl=${baseUrl} phone=${phone}`);

  if (mode === "live") {
    if (!process.env.CALLE_API_KEY || process.env.CALLE_API_KEY === "sim-local") {
      throw new Error("CALLE_LIVE=1 requires a real CALLE_API_KEY from dashboard.heycall-e.com/account/api-keys");
    }
    if (phone.startsWith("+1555")) {
      throw new Error("CALLE_LIVE=1 requires CALLE_SMOKE_PHONE set to your own E.164 number");
    }
  }

  const client = createCalleClient();
  const call = await client.calls.create({
    task,
    recipients: [{ phones: [phone], region: "US", locale: "en-US" }],
    recipientResultSchema: {
      type: "object",
      required: ["can_hear"],
      properties: {
        can_hear: { type: "string", enum: ["yes", "no", "unknown"] },
      },
    },
  });

  console.log(`[smoke] created id=${(call as { id?: string }).id ?? "(see payload)"}`);
  console.log(JSON.stringify(call, null, 2));
}

main().catch((error) => {
  console.error("[smoke] failed");
  console.error(error);
  process.exitCode = 1;
});
