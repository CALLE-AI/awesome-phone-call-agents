import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { appointmentFixture, createInput, normalizeOutcome, syntheticCall } from "./workflow.mjs";

const args = process.argv.slice(2);
if (args.length && !(args.length === 1 && args[0] === "--live")) throw new Error("Usage: node src/cli.mjs [--live]");
const live = args[0] === "--live";
if (!live) {
  const appointment = appointmentFixture();
  console.info(JSON.stringify({ mode: "dry-run", realCallPlaced: false, appointment, result: normalizeOutcome(syntheticCall(appointment), appointment) }, null, 2));
} else {
  if (process.env.CALLE_LIVE_ENABLED !== "true" || process.env.CALLE_CONTACT_AUTHORIZED !== "true" || !process.env.CALLE_API_KEY) {
    throw new Error("Live mode requires explicit enablement, contact authorization, and server-side API credentials.");
  }
  const testPhone = process.env.CALLE_TEST_PHONE ?? "";
  const authorizedDestination = process.env.CALLE_AUTHORIZED_DESTINATION ?? "";
  if (!/^\+[1-9][0-9]{7,14}$/.test(authorizedDestination) || authorizedDestination !== testPhone) {
    throw new Error("Set CALLE_AUTHORIZED_DESTINATION to the exact ASCII E.164 test phone for this live run.");
  }
  const demoId = process.env.CALLE_DEMO_ID;
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(demoId ?? "")) throw new Error("Provide a stable CALLE_DEMO_ID.");
  const directory = new URL("../.state/", import.meta.url);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stateUrl = new URL(`${demoId}.json`, directory);
  let state;
  try { state = JSON.parse(await readFile(stateUrl, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!state) {
    const appointment = appointmentFixture();
    const input = createInput({ appointment, phone: testPhone,
      region: process.env.CALLE_TEST_REGION, locale: process.env.CALLE_TEST_LOCALE,
      demoId, webhookUrl: process.env.CALLE_WEBHOOK_URL || undefined });
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    state = { appointment, input, requestHash, idempotencyKey: `onereach-demo:${demoId}:${requestHash}`, callId: null };
    // Exclusive creation prevents two first-run processes from creating different tasks.
    await writeFile(stateUrl, JSON.stringify(state), { flag: "wx", mode: 0o600 });
  }
  const { CalleClient } = await import("@call-e/calle");
  const client = new CalleClient({ apiKey: process.env.CALLE_API_KEY });
  if (!state.callId) {
    // On uncertain errors rerun with the SAME demo id: saved input and idempotency key are reused.
    const call = await client.calls.create(state.input, { idempotencyKey: state.idempotencyKey });
    state.callId = call.id;
    await writeFile(stateUrl, JSON.stringify(state), { mode: 0o600 });
  }
  console.info(JSON.stringify({ mode: "live", callId: state.callId, warning: "Polling timeout does not hang up a call. This example has no hard duration or physical-dial quota." }));
  const deadline = Date.now() + 5 * 60_000;
  let call;
  do {
    call = await client.calls.get(state.callId);
    if (["completed", "failed", "canceled"].includes(call.status)) break;
    await sleep(5_000);
  } while (Date.now() < deadline);
  const eventPage = await client.calls.listEvents(state.callId);
  const observedAttempts = new Set(call.recipients.flatMap((recipient) => recipient.attempts.filter((attempt) => attempt.startedAt).map((attempt) => attempt.id))).size;
  console.info(JSON.stringify({ callId: call.id, providerStatus: call.status, observedStartedAttempts: observedAttempts,
    eventsOnFirstPage: eventPage.data.length, moreEventsAvailable: Boolean(eventPage.nextCursor), result: normalizeOutcome(call, state.appointment) }, null, 2));
}
