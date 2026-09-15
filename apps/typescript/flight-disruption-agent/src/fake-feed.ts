// Plays an airline ops system that cannot push: serves fixtures/ops-feed.json as a pull feed,
// releasing each event a few seconds after start. Point AIRLINE_FEED_URL at it.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isLoopbackBind } from "./access.ts";
import { APP_ROOT, loadEnvFile } from "./config.ts";

loadEnvFile();
const HOST = process.env.FAKE_FEED_HOST ?? "127.0.0.1";
const PORT = Number(process.env.FAKE_FEED_PORT ?? 4320);
const TOKEN = process.env.AIRLINE_FEED_TOKEN?.trim() || null;
if (!isLoopbackBind(HOST)) {
  console.error("The fake feed only listens on this machine.");
  process.exit(1);
}

const timeline = JSON.parse(readFileSync(join(APP_ROOT, "fixtures", "ops-feed.json"), "utf8")) as {
  publish_after_seconds: number;
  event: Record<string, unknown>;
}[];
const started = Date.now();

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}`);
  const reply = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method !== "GET" || url.pathname !== "/events") return reply(404, { error: "Not found." });
  if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) return reply(401, { error: "Bad token." });
  const published = timeline.filter((t) => (Date.now() - started) / 1000 >= t.publish_after_seconds).map((t) => t.event);
  const cursor = Math.max(0, Number(url.searchParams.get("cursor") ?? 0) || 0);
  const page = published.slice(cursor, cursor + 2);
  reply(200, { events: page, next_cursor: String(cursor + page.length) });
}).listen(PORT, HOST, () => {
  console.log(`Fake airline feed on http://${HOST}:${PORT}/events, releasing ${timeline.length} events over ${Math.max(...timeline.map((t) => t.publish_after_seconds))}s.`);
  console.log(`Start the desk with AIRLINE_FEED_URL=http://${HOST}:${PORT}/events AIRLINE_FEED_POLL_SECONDS=5`);
});
