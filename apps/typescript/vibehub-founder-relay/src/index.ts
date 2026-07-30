import { createHash } from "node:crypto";

import {
  CalleAPIError,
  CalleClient,
  CalleTimeoutError,
  type Call,
} from "@call-e/calle";
import dotenv from "dotenv";

import {
  buildTask,
  isSupportedRegion,
  isValidPhone,
  maskPhone,
  normalizePhone,
} from "./workflow.js";

dotenv.config();

const LIVE_ARGS = ["--place-call", "I_HAVE_CONSENT"];
const shouldCall = LIVE_ARGS.every((value) => process.argv.includes(value));
const phone = normalizePhone(process.env.CALLE_RECIPIENT_PHONE ?? "");
const regionInput = (process.env.CALLE_RECIPIENT_REGION ?? "MY").trim().toUpperCase();
const candidate = (process.env.FOUNDER_RELAY_CANDIDATE ?? "Example Founder").trim();
const goal = (process.env.FOUNDER_RELAY_GOAL ?? "Validate a seven-day collaboration sprint").trim();
const runId = (process.env.FOUNDER_RELAY_RUN_ID ?? "relay-example-001").trim();
const consent = process.env.CALLE_RECIPIENT_CONSENT === "YES";
const terminal = new Set(["completed", "failed", "canceled"]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function networkCode(error: unknown) {
  if (!(error instanceof Error)) return undefined;
  const cause = (error as Error & { cause?: { code?: unknown } }).cause;
  return typeof cause?.code === "string" ? cause.code : undefined;
}

async function waitForResult(client: CalleClient, callId: string): Promise<Call> {
  const deadline = Date.now() + 180_000;
  while (Date.now() <= deadline) {
    try {
      const call = await client.calls.get(callId);
      if (terminal.has(call.status)) return call;
    } catch (error) {
      if (!(error instanceof TypeError) && !networkCode(error)) throw error;
      console.warn(`Result check interrupted (${networkCode(error) ?? "network"}); retrying without creating another call.`);
    }
    await sleep(2_000);
  }
  throw new CalleTimeoutError(`Timed out waiting for ${callId}. The call may still be active.`);
}

async function main() {
  if (!isSupportedRegion(regionInput)) throw new Error("CALLE_RECIPIENT_REGION is not supported by this demo.");
  if (!isValidPhone(phone, regionInput)) throw new Error("CALLE_RECIPIENT_PHONE must be valid E.164 for the selected region.");
  if (!/^[a-z0-9-]{3,80}$/i.test(runId)) throw new Error("FOUNDER_RELAY_RUN_ID contains invalid characters.");

  const task = buildTask(candidate, goal);
  console.log("VibeHub Founder Relay preview");
  console.log(`Recipient: ${maskPhone(phone)}`);
  console.log(`Region: ${regionInput}`);
  console.log(`Run ID: ${runId}`);
  console.log("Duration: under one minute");
  console.log("\nAgent instructions:\n");
  console.log(task);

  if (!shouldCall) {
    console.log("\nPreview only. No call was placed.");
    return;
  }
  if (!consent) throw new Error("Live call blocked: CALLE_RECIPIENT_CONSENT must be exactly YES.");
  if (!process.env.CALLE_API_KEY) throw new Error("Live call blocked: CALLE_API_KEY is missing.");

  const client = new CalleClient({
    apiKey: process.env.CALLE_API_KEY,
    baseUrl: process.env.CALLE_BASE_URL || "https://api.heycall-e.com",
  });
  const phoneHash = createHash("sha256").update(phone).digest("hex").slice(0, 16);

  const created = await client.calls.create(
    {
      task,
      recipients: [{ phones: [phone], region: regionInput, locale: "en-US" }],
      recipientResultSchema: {
        type: "object",
        required: ["available_now", "interest", "focus", "start_window"],
        properties: {
          available_now: { type: "string", enum: ["yes", "no", "unclear"] },
          interest: { type: "string", enum: ["yes", "no", "unsure"] },
          focus: { type: "string", enum: ["product", "engineering", "growth", "research", "other", "unclear"] },
          start_window: { type: "string", enum: ["within_three_days", "this_week", "next_week", "later", "unclear"] },
        },
      },
      metadata: { purpose: "vibehub_founder_relay", run_id: runId },
    },
    { idempotencyKey: `vibehub-founder-relay-${runId}-${phoneHash}` },
  );

  console.log(`\nCall created. Call ID: ${created.id}`);
  const call = terminal.has(created.status) ? created : await waitForResult(client, created.id);
  console.log(JSON.stringify({
    callId: call.id,
    status: call.status,
    taskCompleted: call.taskCompleted,
    summary: call.summary,
    result: call.recipients[0]?.structuredResult ?? null,
    failureCode: call.failureCode,
    failureMessage: call.failureMessage,
  }, null, 2));
}

main().catch((error) => {
  if (error instanceof CalleAPIError) {
    console.error(`CALL-E error (${error.code}, HTTP ${error.status}): ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});
