import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { CalleClient } from "@call-e/calle";
import { handleWebhook } from "./webhook-handler.mjs";

const secret = process.env.CALLE_WEBHOOK_SECRET;
if (!secret) throw new Error("Configure a server-side CALLE_WEBHOOK_SECRET.");
const client = new CalleClient({ apiKey: "local-webhook-verification-only" });
const directory = new URL("../.state/events/", import.meta.url);
await mkdir(directory, { recursive: true, mode: 0o700 });
const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/webhooks/calle") {
    response.writeHead(404).end(); return;
  }
  try {
    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 256 * 1_024) { response.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    const result = await handleWebhook({ rawBody: Buffer.concat(chunks), headers: request.headers, secret, client,
      store: (event) => writeFile(new URL(`${event.id}.json`, directory), JSON.stringify(event), { flag: "wx", mode: 0o600 }),
    });
    response.writeHead(result.status, { "content-type": "application/json" }).end(JSON.stringify(result.body));
  } catch { response.writeHead(500).end(); }
});
server.requestTimeout = 15_000;
server.listen(Number(process.env.PORT || 3188), "127.0.0.1", () => {
  console.info("CALL-E webhook receiver listening on loopback. Expose only /webhooks/calle through your chosen HTTPS tunnel.");
});
