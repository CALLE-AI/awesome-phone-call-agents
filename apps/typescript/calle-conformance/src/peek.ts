/**
 * Reads the rate-limit counter without placing a call.
 *
 * Free only while at the cap. With headroom the request reaches the planner and
 * spends a unit, so this prints a warning when that happens rather than
 * pretending the reading was free. See README, "How it was measured".
 */
import { CalleClient } from "@call-e/calle";
import { unsupportedDestination } from "./unsupported-destination.ts";

const destination = unsupportedDestination();
const client = new CalleClient({ apiKey: process.env.CALLE_API_KEY ?? "" });

try {
  await client.calls.create(
    {
      task: "Ask whether the person can hear the call clearly, thank them, and end the call.",
      recipients: [destination],
      recipientResultSchema: {
        type: "object",
        required: ["heard_clearly"],
        properties: { heard_clearly: { type: "string", enum: ["yes", "no", "unknown"] } },
        additionalProperties: false,
      },
      metadata: { probe: "peek" },
    },
    { idempotencyKey: `peek-${Date.now()}` },
  );
  process.stdout.write(
    `ACCEPTED. Unexpected: ${destination.region} was treated as a supported region.\n` +
      "A call may have been placed. Check the dashboard.\n",
  );
} catch (error) {
  const e = error as Error & { code?: string; status?: number; details?: unknown };
  if (e.code === "rate_limit_exceeded") {
    process.stdout.write(`AT THE CAP. ${JSON.stringify(e.details)}\n`);
    process.stdout.write("This reading was free. Nothing reached the planner.\n");
  } else {
    process.stdout.write(`HEADROOM. The request reached the planner: ${e.status} ${e.code}\n`);
    process.stdout.write(`${e.message}\n`);
    process.stdout.write("This reading spent one unit. It is not returned.\n");
  }
}
