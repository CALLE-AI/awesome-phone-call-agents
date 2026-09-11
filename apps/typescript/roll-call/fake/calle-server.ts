/**
 * Local HTTP wrapper around the scripted fake, for manual demos:
 *
 *   npm run fake-server
 *   CALLE_API_KEY=fake CALLE_BASE_URL=http://127.0.0.1:8787 npm run rollcall -- run --live ...
 *
 * It binds to 127.0.0.1 only and never dials anything.
 */
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { FakeCalleStore, loadFixture } from "./calle-fake.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = process.env.ROLLCALL_FIXTURE ?? resolve(here, "../fixtures/outcomes.json");
const port = Number(process.env.PORT ?? 8787);
const store = new FakeCalleStore(loadFixture(fixturePath), { pollsUntilTerminal: 2 });

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "string") headers[k.toLowerCase()] = v;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const result = store.handle(req.method ?? "GET", url.pathname, headers, raw || null);
    res.writeHead(result.status, { "content-type": "application/json" });
    res.end(JSON.stringify(result.body));
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`fake CALL-E listening on http://127.0.0.1:${port} (fixture ${fixturePath})`);
});
