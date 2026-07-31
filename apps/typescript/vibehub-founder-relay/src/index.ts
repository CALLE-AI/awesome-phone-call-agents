import {
  CalleAPIError,
  CalleClient,
  CalleConnectionError,
  CalleTimeoutError,
  type CreateCallInput,
  type Call,
} from "@call-e/calle";
import dotenv from "dotenv";

import {
  buildTask,
  buildRequestFingerprint,
  isSupportedRegion,
  isValidPhone,
  maskPhone,
  normalizePhone,
  RECIPIENT_RESULT_SCHEMA,
  resolveCalleBaseUrl,
  safeFailureCode,
  verifiedFounderRelayResult,
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

function isAmbiguousCreateError(error: unknown) {
  return error instanceof CalleConnectionError || error instanceof TypeError || Boolean(networkCode(error));
}

async function createWithReconciliation(
  client: CalleClient,
  input: CreateCallInput,
  idempotencyKey: string,
) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await client.calls.create(input, { idempotencyKey });
    } catch (error) {
      if (!isAmbiguousCreateError(error) || attempt === 3) throw error;
      console.warn("CALL-E create response was ambiguous; reconciling with the same idempotency key.");
      await sleep(attempt * 400);
    }
  }
  throw new CalleConnectionError("CALL-E create reconciliation failed.");
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
    baseUrl: resolveCalleBaseUrl(process.env.CALLE_BASE_URL),
  });
  const requestHash = buildRequestFingerprint({ runId, phone, region: regionInput, candidate, goal, task });
  const idempotencyKey = `vibehub-founder-relay-${requestHash.slice(0, 32)}`;

  const created = await createWithReconciliation(
    client,
    {
      task,
      recipients: [{ phones: [phone], region: regionInput, locale: "en-US" }],
      recipientResultSchema: RECIPIENT_RESULT_SCHEMA,
      metadata: { purpose: "vibehub_founder_relay", run_id: runId, request_hash: requestHash },
    },
    idempotencyKey,
  );

  if (created.metadata.request_hash !== requestHash || created.task !== task) {
    throw new Error("CALL-E returned a call that does not match this request fingerprint.");
  }

  console.log(`\nCall created. Call ID: ${created.id}`);
  const call = terminal.has(created.status) ? created : await waitForResult(client, created.id);
  const recipient = call.recipients[0];
  const result = verifiedFounderRelayResult({
    status: call.status,
    taskCompleted: call.taskCompleted,
    completionConfidence: call.completionConfidence,
    recipientStatus: recipient?.status,
    structuredResult: recipient?.structuredResult,
  });

  if (!result) {
    console.log(JSON.stringify({
      callId: call.id,
      status: call.status,
      taskCompleted: call.taskCompleted === true,
      result: null,
      failureCode: safeFailureCode(call.failureCode) ?? "UNVERIFIED_RESULT",
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({
    callId: call.id,
    status: call.status,
    taskCompleted: true,
    completionConfidence: call.completionConfidence?.score,
    summary: `Interest: ${result.interest}; focus: ${result.focus}; start window: ${result.start_window}.`,
    result,
  }, null, 2));
}

main().catch((error) => {
  if (error instanceof CalleAPIError) {
    console.error(`CALL-E request failed (${safeFailureCode(error.code) ?? "API_ERROR"}, HTTP ${error.status}).`);
  } else {
    console.error("Founder Relay stopped safely before producing a verified result.");
  }
  process.exitCode = 1;
});
