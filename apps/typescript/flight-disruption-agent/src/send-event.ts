// Plays the airline ops system: signs a disruption event and posts it to the local desk.
// npm run send-event -- cancel NA721-2026-09-20 [fm] | delay NA721-2026-09-20 240 [fm]
import { randomUUID } from "node:crypto";
import { gatewayFromEnv, loadEnvFile, webhookSecretFromEnv } from "./config.ts";
import { SIGNATURE_HEADER, signPayload } from "./events.ts";

loadEnvFile();
const [kind = "delay", flightId = "NA721-2026-09-20", ...rest] = process.argv.slice(2);
const fm = rest.includes("fm");
const minutes = Number(rest.find((r) => /^\d+$/.test(r)) ?? 240);
if (kind !== "delay" && kind !== "cancel") {
  console.error("Usage: npm run send-event -- delay <flightId> <minutes> [fm] | cancel <flightId> [fm]");
  process.exit(2);
}

const { secret } = webhookSecretFromEnv(gatewayFromEnv().live);
if (!secret) {
  console.error("Set AIRLINE_WEBHOOK_SECRET in .env to the same value the desk server uses.");
  process.exit(2);
}
const event = {
  id: process.env.EVENT_ID ?? `ops_${randomUUID()}`,
  type: kind === "cancel" ? "flight.cancelled" : "flight.delayed",
  occurred_at: new Date().toISOString(),
  flight: { id: flightId },
  ...(kind === "delay" ? { delay_minutes: minutes } : {}),
  cause: fm ? "force_majeure" : "operational",
  reason: fm ? "volcanic ash on the route" : kind === "cancel" ? "a crew shortage" : "a late inbound aircraft",
};
const body = JSON.stringify(event);
const url = `http://${process.env.HOST ?? "127.0.0.1"}:${process.env.PORT ?? 4310}/api/webhooks/airline-ops`;
const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", [SIGNATURE_HEADER]: signPayload(secret, body, Math.floor(Date.now() / 1000)) },
  body,
});
console.log(`${res.status} ${JSON.stringify(await res.json(), null, 2)}`);
