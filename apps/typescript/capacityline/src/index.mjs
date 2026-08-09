import { randomUUID } from "node:crypto";
import { CalleClient } from "@call-e/calle";
import { buildPayload, maskPhone } from "./workflow.mjs";

const live = process.argv.includes("--live");
const fictionalPreview = [
  { id: "supplier-jp", phone: "+1555010100", region: "US", locale: "en-US" },
  { id: "supplier-my", phone: "+1555010101", region: "US", locale: "en-US" },
];

function parseLiveRecipients() {
  const raw = process.env.CAPACITYLINE_RECIPIENTS_JSON;
  if (!raw) throw new Error("CAPACITYLINE_RECIPIENTS_JSON is required for live mode.");
  const recipients = JSON.parse(raw);
  if (!Array.isArray(recipients) || recipients.length < 1 || recipients.length > 8) {
    throw new Error("Provide between one and eight authorized recipients.");
  }
  const e164 = /^\+[1-9]\d{7,14}$/;
  if (recipients.some((item) => !item || typeof item.id !== "string" || !e164.test(item.phone))) {
    throw new Error("Every recipient needs an id and valid E.164 phone number.");
  }
  return recipients;
}

if (!live) {
  const preview = buildPayload(fictionalPreview);
  preview.recipients = fictionalPreview.map((recipient) => ({
    ...recipient,
    phone: maskPhone(recipient.phone),
  }));
  console.log(JSON.stringify({ mode: "dry-run", sideEffect: "none", preview }, null, 2));
  process.exit(0);
}

if (process.env.CAPACITYLINE_CONFIRM_LIVE !== "YES") {
  throw new Error("Set CAPACITYLINE_CONFIRM_LIVE=YES only after confirming every recipient expects the call.");
}
if (!process.env.CALLE_API_KEY) throw new Error("CALLE_API_KEY is required for live mode.");

const recipients = parseLiveRecipients();
const client = new CalleClient({
  apiKey: process.env.CALLE_API_KEY,
  baseUrl: process.env.CALLE_BASE_URL || "https://api.heycall-e.com",
});
const runKey = process.env.CAPACITYLINE_RUN_KEY || randomUUID();
const call = await client.calls.create(buildPayload(recipients), {
  idempotencyKey: `capacityline_example_${runKey}`,
});

console.log(JSON.stringify({
  mode: "live",
  sideEffect: "outbound_calls_created",
  callId: call.id,
  status: call.status,
  recipientCount: recipients.length,
}, null, 2));
