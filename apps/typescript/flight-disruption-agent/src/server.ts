import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { checkAccess, isLoopbackBind } from "./access.ts";
import { CliPlanner } from "./calle.ts";
import { CHANNEL_SIGNATURE_HEADER, ChannelMessageError, httpChannelNotifier, parseChannelMessage } from "./channel.ts";
import {
  APP_ROOT,
  channelNotifyUrlFromEnv,
  channelSecretFromEnv,
  demoClockFromEnv,
  gatewayFromEnv,
  liveAttestationError,
  loadEnvFile,
  webhookSecretFromEnv,
} from "./config.ts";
import { loadCatalog } from "./data.ts";
import { Desk, DeskError } from "./desk.ts";
import { OpsEventError, parseOpsEvent, SIGNATURE_HEADER, signPayload, verifySignature } from "./events.ts";
import { FeedPoller, feedConfigFromEnv } from "./feed.ts";
import type { Action, DisruptionCause, DisruptionKind, RequestChannel, RequestKind } from "./types.ts";

loadEnvFile();

const gateway = gatewayFromEnv();
const attestation = liveAttestationError(gateway.live);
if (attestation) {
  console.error(attestation);
  process.exit(1);
}
const catalog = loadCatalog();
const webhook = webhookSecretFromEnv(gateway.live);
const channelWebhook = channelSecretFromEnv(gateway.live);
const channelNotifyUrl = channelNotifyUrlFromEnv();
const demoClock = demoClockFromEnv();
const desk = new Desk(catalog, gateway, {
  channelNotifier:
    channelNotifyUrl && channelWebhook.secret ? httpChannelNotifier(channelNotifyUrl, channelWebhook.secret, signPayload) : undefined,
  demoNow: demoClock.now,
  // "Check with CALL-E": plans a call with CALL-E through the local calle CLI login. Never dials.
  planner: process.env.CALLE_PLAN_CHECK?.trim() === "off" ? undefined : new CliPlanner(process.env.CALLE_CLI?.trim() || undefined),
  planPhone: process.env.CALLE_PLAN_PHONE?.trim() || process.env.LIVE_DEMO_PHONE?.trim() || undefined,
  // Live runs persist call ids so polling can resume after a restart. Dry runs start fresh.
  statePath: gateway.live ? join(APP_ROOT, ".data", `state-${gateway.mode}.json`) : null,
  liveDemoPhone: process.env.LIVE_DEMO_PHONE?.trim() || undefined,
  liveCallBudget: Number(process.env.LIVE_CALL_BUDGET ?? 3),
});
const feedConfig = feedConfigFromEnv();
const feed = feedConfig ? new FeedPoller(desk, catalog, feedConfig) : null;

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 4310);
const OPERATOR_TOKEN = process.env.OPERATOR_TOKEN?.trim() || null;
const WEBHOOK_PATH = "/api/webhooks/airline-ops";
const CHANNEL_WEBHOOK_PATH = "/api/webhooks/channel";
/** Signed server-to-server endpoints; they authenticate by signature instead of the dashboard access check. */
const SIGNED_PATHS = new Set([WEBHOOK_PATH, CHANNEL_WEBHOOK_PATH]);

if (!isLoopbackBind(HOST) && !OPERATOR_TOKEN) {
  console.error(`Refusing to listen on ${HOST}: the dashboard can place calls. Keep HOST=127.0.0.1 or set OPERATOR_TOKEN.`);
  process.exit(1);
}
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

async function readRaw(req: IncomingMessage): Promise<string> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64_000) throw new DeskError("Request body too large.", 413);
  }
  return raw;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readRaw(req);
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

  // Server-to-server: authenticated by signature, not by the browser Origin check above.
  if (req.method === "POST" && path === WEBHOOK_PATH) {
    if (!webhook.secret) throw new DeskError("Airline ops webhook is disabled: set AIRLINE_WEBHOOK_SECRET.", 503);
    const raw = await readRaw(req);
    const header = req.headers[SIGNATURE_HEADER];
    const check = verifySignature(webhook.secret, raw, Array.isArray(header) ? header[0] : header, Date.now());
    if (!check.ok) throw new DeskError(check.reason, 401);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new DeskError("Request body must be JSON.");
    }
    let event;
    try {
      event = parseOpsEvent(catalog, body);
    } catch (error) {
      if (error instanceof OpsEventError) throw new DeskError(error.message, 422);
      throw error;
    }
    const { record, duplicate } = desk.receiveOpsEvent(event);
    const status = duplicate ? 200 : record.status === "created" || record.status === "escalated" ? 201 : record.status === "conflict" ? 409 : 422;
    return send(res, status, { duplicate, ...record });
  }

  if (req.method === "POST" && path === CHANNEL_WEBHOOK_PATH) {
    if (!channelWebhook.secret) throw new DeskError("Channel webhook is disabled: set CHANNEL_WEBHOOK_SECRET.", 503);
    const raw = await readRaw(req);
    const header = req.headers[CHANNEL_SIGNATURE_HEADER];
    const check = verifySignature(channelWebhook.secret, raw, Array.isArray(header) ? header[0] : header, Date.now(), CHANNEL_SIGNATURE_HEADER);
    if (!check.ok) throw new DeskError(check.reason, 401);
    let message;
    try {
      message = parseChannelMessage(JSON.parse(raw));
    } catch (error) {
      if (error instanceof SyntaxError) throw new DeskError("Request body must be JSON.");
      if (error instanceof ChannelMessageError) throw new DeskError(error.message, 422);
      throw error;
    }
    const { record, duplicate } = desk.receiveChannelMessage(message);
    // 200 either way: a refused message still carries the reply the channel shows the passenger.
    return send(res, 200, { duplicate, ...record });
  }

  if (req.method === "GET" && path === "/api/state") {
    await desk.refreshAll();
    return send(res, 200, { ...desk.snapshot(), feed: feed?.status() ?? null });
  }
  if (req.method === "POST" && path === "/api/feed/poll") {
    if (!feed) throw new DeskError("No airline feed configured: set AIRLINE_FEED_URL.", 404);
    await feed.poll();
    return send(res, 200, feed.status());
  }
  if (req.method === "POST" && path === "/api/disruptions") {
    const body = await readJson(req);
    const disruption = desk.reportDisruption({
      flightId: str(body, "flightId"),
      kind: (body.kind ?? "delay") as DisruptionKind,
      cause: (body.cause ?? "operational") as DisruptionCause,
      delayMinutes: Number(body.delayMinutes ?? 0),
      reason: String(body.reason ?? ""),
    });
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
  if (req.method === "POST" && path === "/api/requests") {
    const body = await readJson(req);
    const target = typeof body.targetFlightId === "string" && body.targetFlightId ? body.targetFlightId : null;
    const entry = desk.submitRequest(str(body, "pnr"), str(body, "kind") as RequestKind, target, str(body, "channel") as RequestChannel);
    return send(res, 201, entry);
  }
  if (req.method === "POST" && path === "/api/calle/plan") {
    const body = await readJson(req);
    const kind = str(body, "kind");
    const target =
      kind === "passenger"
        ? { kind: "passenger" as const, disruptionId: str(body, "disruptionId"), pnr: str(body, "pnr") }
        : kind === "intake" || kind === "airline"
          ? { kind: kind as "intake" | "airline", id: str(body, "id") }
          : null;
    if (!target) throw new DeskError('kind must be "passenger", "intake", or "airline".');
    return send(res, 200, await desk.checkWithCalle(target));
  }
  if (req.method === "POST" && path === "/api/requests/passenger/preview") {
    const body = await readJson(req);
    return send(res, 200, desk.previewPassengerCall(str(body, "id")));
  }
  if (req.method === "POST" && path === "/api/requests/passenger/start") {
    const body = await readJson(req);
    const confirm = typeof body.confirmLast4 === "string" ? body.confirmLast4 : undefined;
    return send(res, 201, await desk.callPassengerForRequest(str(body, "id"), confirm));
  }
  if (req.method === "POST" && path === "/api/requests/airline/preview") {
    const body = await readJson(req);
    return send(res, 200, desk.previewAirlineCall(str(body, "id")));
  }
  if (req.method === "POST" && path === "/api/requests/airline/start") {
    const body = await readJson(req);
    const confirm = typeof body.confirmLast4 === "string" ? body.confirmLast4 : undefined;
    return send(res, 201, await desk.callAirlineDesk(str(body, "id"), confirm));
  }
  if (req.method === "POST" && path === "/api/requests/callback/preview") {
    const body = await readJson(req);
    return send(res, 200, desk.previewCallback(str(body, "id")));
  }
  if (req.method === "POST" && path === "/api/requests/callback/start") {
    const body = await readJson(req);
    const confirm = typeof body.confirmLast4 === "string" ? body.confirmLast4 : undefined;
    return send(res, 201, await desk.callPassengerWithResult(str(body, "id"), confirm));
  }
  if (req.method === "POST" && path === "/api/requests/resolve") {
    const body = await readJson(req);
    const newPnr = typeof body.newPnr === "string" ? body.newPnr.trim().toUpperCase() : "";
    const ticket = typeof body.ticket === "string" ? body.ticket.trim() : "";
    const reissue = newPnr || ticket ? { pnr: newPnr, ticket } : undefined;
    return send(res, 200, desk.resolveRequest(str(body, "id"), body.apply === true, String(body.note ?? ""), reissue));
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
  // Every route except the signed webhooks is the operator dashboard.
  if (!(req.method === "POST" && SIGNED_PATHS.has(path))) {
    const access = checkAccess(
      { remoteAddress: req.socket.remoteAddress, host: req.headers.host, authorization: req.headers.authorization },
      OPERATOR_TOKEN,
    );
    if (!access.ok) {
      if (access.challenge) res.setHeader("www-authenticate", 'Basic realm="Disruption Desk", charset="UTF-8"');
      return send(res, access.status, { error: access.message });
    }
  }
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
  if (feed && feedConfig) {
    feed.start();
    console.log(`Polling the airline event feed ${new URL(feedConfig.url).origin} every ${feedConfig.intervalSeconds}s.`);
  }
  console.log(`Flight disruption desk on http://${HOST}:${PORT}  [${live}]`);
  console.log(OPERATOR_TOKEN ? "Dashboard requires the operator token (HTTP Basic, any user name)." : "Dashboard accepts loopback connections only.");
  if (demoClock.label) console.log(`Demo clock: passenger request cutoffs use ${demoClock.label}. Set DEMO_NOW=real for the real time.`);
  if (channelNotifyUrl) console.log(`Request updates for passenger channels go to ${new URL(channelNotifyUrl).origin}.`);
  if (!channelWebhook.secret) console.log("Channel webhook disabled: set CHANNEL_WEBHOOK_SECRET to enable POST /api/webhooks/channel.");
  else if (channelWebhook.demo) console.log("Channel webhook uses the dry-run demo secret. Set CHANNEL_WEBHOOK_SECRET before connecting a real channel.");
  if (!webhook.secret) console.log("Airline ops webhook disabled: set AIRLINE_WEBHOOK_SECRET to enable POST /api/webhooks/airline-ops.");
  else if (webhook.demo) console.log("Airline ops webhook uses the dry-run demo secret. Set AIRLINE_WEBHOOK_SECRET before exposing it anywhere.");
});
