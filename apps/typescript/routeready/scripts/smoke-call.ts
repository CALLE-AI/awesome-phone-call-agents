// Phase 0 smoke test: one real CALL-E call to a phone you own, using the same
// SDK, task text and readiness schema RouteReady uses.
// Preview by default (no call). Pass --live to place the call.
import { mkdirSync, writeFileSync } from "node:fs";
import { CalleAPIError, CalleClient, type Call } from "@call-e/calle";
import { READINESS_SCHEMA, buildReadinessTask } from "../src/calle/task.js";
import { isE164, maskPhone } from "../src/core/phone.js";

const TERMINAL = new Set(["completed", "failed", "canceled"]);
const POLL_MS = 5_000;
const MAX_WAIT_MS = 10 * 60_000;

try {
  process.loadEnvFile(".env");
} catch {
  // No .env file: fall back to the shell environment.
}

const live = process.argv.includes("--live");
const apiKey = process.env.CALLE_API_KEY?.trim() ?? "";
const phone = process.env.SMOKE_PHONE?.trim() ?? "";
const region = process.env.SMOKE_REGION?.trim() || "BD";
const locale = process.env.SMOKE_LOCALE?.trim() || undefined;
const language = process.env.SMOKE_LANGUAGE?.trim() || "English";
const runId = process.env.SMOKE_ID?.trim() || `smoke-${new Date().toISOString().slice(0, 10)}-v1`;

if (!isE164(phone)) fail("SMOKE_PHONE must be an E.164 number such as +8801XXXXXXXXX.");

const task = buildReadinessTask({
  merchant: "RouteReady",
  orderRef: "RR-TEST-001",
  etaMinutes: 20,
  codAmount: "1,250 taka",
  language,
  testCall: true,
});
const idempotencyKey = `routeready:${runId}`;

console.log(`Mode: ${live ? "LIVE - this places one real call" : "preview - no call"}`);
console.log(`To: ${maskPhone(phone)}  region=${region}  locale=${locale ?? "(platform default)"}  language=${language}`);
console.log(`Idempotency key: ${idempotencyKey}`);
console.log(`\nTask:\n${task}\n`);

if (!live) {
  console.log("Preview only. Run `npm run smoke:live` to place the call.");
  process.exit(0);
}
if (!apiKey) fail("CALLE_API_KEY is not set.");

const client = new CalleClient({ apiKey });
mkdirSync("results", { recursive: true });
const outFile = `results/${runId}.json`;
const startedAt = Date.now();

let call: Call;
try {
  call = await client.calls.create(
    {
      task,
      recipient: { phone, region, ...(locale ? { locale } : {}) },
      recipientResultSchema: READINESS_SCHEMA,
      metadata: { app: "routeready", run: runId },
    },
    { idempotencyKey },
  );
} catch (error) {
  if (error instanceof CalleAPIError) {
    fail(`CALL-E refused the request (${error.status} ${error.code}): ${error.message}`);
  }
  console.error("The request failed before a response came back, so the call may or may not have been placed.");
  console.error(`Re-run with the same SMOKE_ID (${runId}): the idempotency key returns the existing call instead of dialling again.`);
  throw error;
}

writeFileSync(outFile, JSON.stringify({ callId: call.id, idempotencyKey }, null, 2));
console.log(`Accepted as ${call.id} (${call.status}). Your phone should ring shortly.\n`);

const seen = new Set<string>();
while (!TERMINAL.has(call.status) && Date.now() - startedAt < MAX_WAIT_MS) {
  await sleep(POLL_MS);
  try {
    call = await client.calls.get(call.id);
    const events = await client.calls.listEvents(call.id, { limit: 100 });
    for (const event of events.data) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      console.log(`  +${elapsed()}s  ${event.type}  ${event.status}  ${event.message}`);
    }
  } catch (error) {
    console.error(`  +${elapsed()}s  poll failed, retrying: ${(error as Error).message}`);
  }
}

writeFileSync(outFile, JSON.stringify(call, null, 2));
console.log(`\nStatus: ${call.status} after ${elapsed()}s (full result saved to ${outFile}, git-ignored)`);
if (call.failureCode) console.log(`Failure: ${call.failureCode}: ${call.failureMessage ?? ""}`);
console.log(
  `Task completed: ${call.taskCompleted}  confidence: ${call.completionConfidence?.label ?? "n/a"} ${call.completionConfidence?.score ?? ""}`,
);
for (const recipient of call.recipients) {
  console.log(`\nRecipient ${maskPhone(recipient.phones[0] ?? "")}: ${recipient.status}`);
  console.log(`Structured result: ${JSON.stringify(recipient.structuredResult, null, 2)}`);
  for (const attempt of recipient.attempts) {
    const failure = attempt.failureCode ? ` (${attempt.failureCode})` : "";
    console.log(`Attempt ${attempt.status}: ${attempt.startedAt ?? "?"} -> ${attempt.completedAt ?? "?"}${failure}`);
    for (const turn of attempt.transcriptTurns) {
      console.log(`  [${turn.offset_seconds ?? "?"}s] ${turn.speaker}: ${turn.text}`);
    }
  }
}
if (!TERMINAL.has(call.status)) {
  console.log("\nNot finished after 10 minutes. Check Call Records in the dashboard before placing another call.");
}

function elapsed(): number {
  return Math.round((Date.now() - startedAt) / 1000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}
