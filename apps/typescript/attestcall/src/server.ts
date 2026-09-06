/**
 * Minimal HTTP server (Node built-ins only) exposing the AttestCall dashboard
 * and JSON endpoints. No framework dependency, so it installs and runs fast.
 *
 *   GET  /                -> dashboard
 *   GET  /api/config      -> { demo, scenarios }
 *   POST /api/preview     -> dry-run preview (no call)
 *   POST /api/attest      -> place/simulate call + sealed audit record
 *   GET  /api/records     -> all sealed records + chain integrity
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig } from "./config.js";
import { preview, run } from "./runner.js";
import { AuditChain } from "./audit.js";
import { FIXTURE_SCENARIOS } from "./fixtures.js";
import type { AttestationRequest } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = loadConfig();

function json(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

async function readBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/") {
      const html = await readFile(join(__dirname, "public", "index.html"), "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/config") {
      json(res, 200, { demo: config.demo, scenarios: FIXTURE_SCENARIOS });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/preview") {
      const body = (await readBody(req)) as AttestationRequest;
      json(res, 200, preview(body, config));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/attest") {
      const body = (await readBody(req)) as AttestationRequest & { scenario?: string };
      const opts = body.scenario ? { fixtureScenario: body.scenario } : {};
      const result = await run(body, config, opts);
      json(res, 200, result);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/records") {
      const chain = new AuditChain(config.auditFile);
      json(res, 200, { records: chain.all(), integrity: chain.verify() });
      return;
    }

    json(res, 404, { error: "not_found" });
  } catch (err) {
    json(res, 400, { error: err instanceof Error ? err.message : "bad_request" });
  }
});

server.listen(config.port, () => {
  console.log(
    `AttestCall dashboard on http://localhost:${config.port}  (mode: ${config.demo ? "DEMO" : "LIVE"})`,
  );
});
