import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { APP_ROOT, gatewayFromEnv, loadEnvFile } from "./config.ts";
import { loadCatalog } from "./data.ts";
import { Desk, DeskError } from "./desk.ts";
import type { Action } from "./types.ts";

loadEnvFile();

const gateway = gatewayFromEnv();
const desk = new Desk(loadCatalog(), gateway, {
  // Live runs persist call ids so polling can resume after a restart. Dry runs start fresh.
  statePath: gateway.live ? join(APP_ROOT, ".data", `state-${gateway.mode}.json`) : null,
  liveDemoPhone: process.env.LIVE_DEMO_PHONE?.trim() || undefined,
  liveCallBudget: Number(process.env.LIVE_CALL_BUDGET ?? 3),
});

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 4310);
const PUBLIC = join(APP_ROOT, "public");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64_000) throw new DeskError("Request body too large.", 413);
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new DeskError("Request body must be JSON.");
  }
}

function str(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value) throw new DeskError(`Missing "${key}".`);
  return value;
}

function parseAction(value: unknown): Action | null {
  if (value === null || value === "none") return null;
  if (value === "keep" || value === "refund") return { kind: value };
  if (typeof value === "string" && value.startsWith("move:")) return { kind: "move", optionId: value.slice(5) };
  throw new DeskError('action must be "keep", "refund", "move:<flightId>", or "none".');
}

async function api(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  // Browsers send Origin on cross-site POSTs; refuse anything that is not this page.
  if (req.method === "POST") {
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`) throw new DeskError("Cross-origin request refused.", 403);
  }

  if (req.method === "GET" && path === "/api/state") {
    await desk.refreshAll();
    return send(res, 200, desk.snapshot());
  }
  if (req.method === "POST" && path === "/api/disruptions") {
    const body = await readJson(req);
    const disruption = desk.reportDelay(str(body, "flightId"), Number(body.delayMinutes), String(body.reason ?? ""));
    return send(res, 201, disruption);
  }
  if (req.method === "POST" && path === "/api/calls/preview") {
    const body = await readJson(req);
    return send(res, 200, desk.preview(str(body, "disruptionId"), str(body, "pnr")));
  }
  if (req.method === "POST" && path === "/api/calls/start") {
    const body = await readJson(req);
    const confirm = typeof body.confirmLast4 === "string" ? body.confirmLast4 : undefined;
    return send(res, 201, await desk.startCall(str(body, "disruptionId"), str(body, "pnr"), confirm));
  }
  if (req.method === "POST" && path === "/api/calls/resolve") {
    const body = await readJson(req);
    return send(res, 200, desk.resolve(str(body, "key"), parseAction(body.action), String(body.note ?? "")));
  }
  if (req.method === "POST" && path === "/api/reset") {
    desk.reset();
    return send(res, 200, { ok: true });
  }
  send(res, 404, { error: "Not found." });
}

async function staticFile(res: ServerResponse, path: string): Promise<void> {
  const file = normalize(join(PUBLIC, path === "/" ? "index.html" : path));
  if (!file.startsWith(PUBLIC)) return send(res, 404, { error: "Not found." });
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    send(res, 404, { error: "Not found." });
  }
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  try {
    if (path.startsWith("/api/")) await api(req, res, path);
    else await staticFile(res, path);
  } catch (error) {
    const status = error instanceof DeskError ? error.status : 500;
    const message = error instanceof Error ? error.message : String(error);
    if (status === 500) console.error(error);
    send(res, status, { error: message });
  }
});

server.listen(PORT, HOST, () => {
  const live = gateway.live ? `LIVE (${gateway.mode}) - real calls go to LIVE_DEMO_PHONE only` : "dry-run - no calls are placed";
  console.log(`Flight disruption desk on http://${HOST}:${PORT}  [${live}]`);
});
