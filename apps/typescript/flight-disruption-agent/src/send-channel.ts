// Plays a passenger channel (chat bot, web form backend, or phone IVR): signs a message and posts it.
// npm run send-channel -- submit P3X9GA Saputra reschedule NA729-2026-09-20
// npm run send-channel -- submit L6F2KM Kusuma            (open "change": the passenger picks on the call)
// CHANNEL=web_form CONVERSATION_ID=form-42 npm run send-channel -- ...
import { randomUUID } from "node:crypto";
import { CHANNEL_SIGNATURE_HEADER } from "./channel.ts";
import { channelSecretFromEnv, gatewayFromEnv, loadEnvFile } from "./config.ts";
import { signPayload } from "./events.ts";

loadEnvFile();
const [action, ...args] = process.argv.slice(2);
const base = {
  id: process.env.MESSAGE_ID ?? `msg_${randomUUID()}`,
  channel: process.env.CHANNEL ?? "chat",
  conversation_id: process.env.CONVERSATION_ID ?? "conv-demo-1",
};
let message: Record<string, unknown>;
if (action === "submit" && args.length >= 2) {
  const [pnr, lastName, kind, target] = args;
  message = { ...base, type: "request.submitted", pnr, last_name: lastName, ...(kind ? { kind } : {}), ...(target ? { target_flight_id: target } : {}) };
} else {
  console.error("Usage: npm run send-channel -- submit <pnr> <last name> [reschedule|refund|change] [flightId]");
  process.exit(2);
}

const { secret } = channelSecretFromEnv(gatewayFromEnv().live);
if (!secret) {
  console.error("Set CHANNEL_WEBHOOK_SECRET in .env to the same value the desk server uses.");
  process.exit(2);
}
const body = JSON.stringify(message);
const url = `http://${process.env.HOST ?? "127.0.0.1"}:${process.env.PORT ?? 4310}/api/webhooks/channel`;
const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", [CHANNEL_SIGNATURE_HEADER]: signPayload(secret, body, Math.floor(Date.now() / 1000)) },
  body,
});
const data = (await res.json()) as { reply?: string; requestId?: string | null; outcome?: string; duplicate?: boolean; error?: string };
console.log(`${res.status} ${data.outcome ?? ""} ${data.requestId ?? ""}${data.duplicate ? " (duplicate message, nothing changed)" : ""}`.trim());
console.log(data.reply ?? data.error ?? JSON.stringify(data));
