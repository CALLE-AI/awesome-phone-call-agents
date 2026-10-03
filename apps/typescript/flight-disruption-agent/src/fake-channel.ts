// Plays the passenger channel's receiving side: prints request updates the desk pushes,
// after checking their signature. Point CHANNEL_NOTIFY_URL at http://127.0.0.1:4330/updates.
import { createServer } from "node:http";
import { isLoopbackBind } from "./access.ts";
import { CHANNEL_SIGNATURE_HEADER } from "./channel.ts";
import { channelSecretFromEnv, gatewayFromEnv, loadEnvFile } from "./config.ts";
import { verifySignature } from "./events.ts";

loadEnvFile();
const HOST = process.env.FAKE_CHANNEL_HOST ?? "127.0.0.1";
const PORT = Number(process.env.FAKE_CHANNEL_PORT ?? 4330);
if (!isLoopbackBind(HOST)) {
  console.error("The fake channel only listens on this machine.");
  process.exit(1);
}
const { secret } = channelSecretFromEnv(gatewayFromEnv().live);
if (!secret) {
  console.error("Set CHANNEL_WEBHOOK_SECRET to the same value the desk server uses.");
  process.exit(2);
}

createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const header = req.headers[CHANNEL_SIGNATURE_HEADER];
  const check = verifySignature(secret, raw, Array.isArray(header) ? header[0] : header, Date.now(), CHANNEL_SIGNATURE_HEADER);
  if (req.method !== "POST" || req.url !== "/updates" || !check.ok) {
    res.writeHead(check.ok ? 404 : 401).end();
    if (!check.ok) console.log(`Refused an update: ${check.reason}`);
    return;
  }
  const update = JSON.parse(raw) as { channel: string; conversation_id: string; request_id: string; status: string; reply: string };
  console.log(`\n[${update.channel} ${update.conversation_id}] ${update.request_id} -> ${update.status}\n${update.reply}`);
  res.writeHead(204).end();
}).listen(PORT, HOST, () => console.log(`Fake passenger channel listening on http://${HOST}:${PORT}/updates`));
