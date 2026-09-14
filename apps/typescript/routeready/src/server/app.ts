// RouteReady web server: the rider app at /app, a two-phone showcase at /,
// and your own route with real calls at /route.
// Simulated days need no credentials. Server-side live calls are off unless
// configured, and a live day can only be started with the token printed at
// startup. On /route each visitor brings their own CALL-E key for one route.
import { CalleAuthenticationError, CalleClient } from "@call-e/calle";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { calleClientOptions } from "../calle/endpoint.js";
import { LivePort } from "../calle/ports.js";
import { loadDay } from "../core/day.js";
import { CallLedger, REPEAT_APPROVAL } from "../core/ledger.js";
import { maskPhone } from "../core/phone.js";
import { maskPhonesInText } from "../core/redact.js";
import { FieldRegistry } from "../field/registry.js";
import { FIELD_CONSENT, MAX_FIELD_STOPS, parseFieldStart, point } from "../field/setup.js";
import { isLoopbackHost, loadLiveConfig } from "./config.js";
import { PACES, RepeatCallError, RunController, type Mode, type Pace } from "./run.js";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env file: use the shell environment.
}

const WEB_DIR = new URL("../../web/", import.meta.url);
const HTML = "text/html; charset=utf-8";
const JS = "text/javascript; charset=utf-8";
const PAGES: Record<string, [file: string, type: string]> = {
  "/": ["showcase.html", HTML],
  "/app": ["app.html", HTML],
  "/rider": ["app.html", HTML],
  "/app.js": ["app.js", JS],
  "/screens.js": ["screens.js", JS],
  "/shared.js": ["shared.js", JS],
  "/app.css": ["app.css", "text/css; charset=utf-8"],
  "/route": ["route.html", HTML],
  "/route.js": ["route.js", JS],
  "/route.css": ["route.css", "text/css; charset=utf-8"],
  "/splash.js": ["splash.js", JS],
  "/splash.css": ["splash.css", "text/css; charset=utf-8"],
  "/favicon.svg": ["favicon.svg", "image/svg+xml"],
};
const CONSENT = "Every live number belongs to me or to someone who agreed to take these calls.";

const host = process.env.HOST?.trim() || "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
const loaded = loadDay();
const live = loadLiveConfig(process.env, loaded.day, host);
const startToken = process.env.ROUTEREADY_TOKEN?.trim() || randomBytes(9).toString("base64url");
/** One call per destination per day, shared by the demo day and every visitor route on this server. */
const ledger = new CallLedger();
const controller = new RunController(loaded, live.config, ledger);
/** Optional override for tests against a local fake of the CALL-E API. Real keys only go to approved HTTPS origins. */
const calleBaseUrl = process.env.CALLE_BASE_URL?.trim() || undefined;
const calleClient = (apiKey: string) => new CalleClient(calleClientOptions(apiKey, calleBaseUrl));
const routes = new FieldRegistry((apiKey) => new LivePort(calleClient(apiKey)), ledger);
routes.startLoop();

const server = createServer((request, response) => {
  handle(request, response).catch((error: Error) => sendJson(response, 500, { error: error.message }));
});

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const refusal = refuseRequest(request);
  if (refusal) return sendJson(response, 403, { error: refusal });

  if (request.method === "GET" && PAGES[path]) {
    const [file, type] = PAGES[path];
    response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    response.end(readFileSync(fileURLToPath(new URL(file, WEB_DIR))));
    return;
  }
  if (request.method === "GET" && path === "/api/day") {
    sendJson(response, 200, dayForScreens());
    return;
  }
  if (request.method === "GET" && path === "/api/stream") {
    stream(request, response);
    return;
  }
  if (path.startsWith("/api/route/")) {
    await handleRoute(request, response, path);
    return;
  }
  if (request.method === "POST" && path === "/api/run") {
    const body = await readJson(request);
    const mode: Mode = body.mode === "live" ? "live" : "simulate";
    if (mode === "live") {
      if (!live.config) return sendJson(response, 400, { error: `Live mode unavailable: ${live.problem}` });
      if (!sameSecret(String(body.token ?? ""), startToken)) return sendJson(response, 403, { error: "Wrong start token." });
      if (body.consent !== CONSENT) return sendJson(response, 400, { error: "Confirm that every live number agreed to take these calls." });
    }
    try {
      await controller.start(mode, parsePace(body.pace), body.repeatApproval === REPEAT_APPROVAL);
    } catch (error) {
      if (error instanceof RepeatCallError) {
        return sendJson(response, 409, { error: error.message, repeat: error.numbers, approval: REPEAT_APPROVAL });
      }
      return sendJson(response, 409, { error: (error as Error).message });
    }
    sendJson(response, 200, { ok: true, mode });
    return;
  }
  if (request.method === "POST" && (path === "/api/pause" || path === "/api/resume")) {
    controller.setPaused(path === "/api/pause");
    sendJson(response, 200, { ok: true });
    return;
  }
  if (request.method === "POST" && path === "/api/pace") {
    const body = await readJson(request);
    controller.setPace(parsePace(body.pace));
    sendJson(response, 200, { ok: true });
    return;
  }
  if (request.method === "POST" && path === "/api/stop") {
    controller.stop();
    sendJson(response, 200, { ok: true });
    return;
  }
  sendJson(response, 404, { error: "Not found" });
}

/** Your own route: a visitor's CALL-E key, their stops, and their rider position. */
async function handleRoute(request: IncomingMessage, response: ServerResponse, path: string): Promise<void> {
  if (request.method === "GET" && path === "/api/route/config") {
    sendJson(response, 200, { consent: FIELD_CONSENT, maxStops: MAX_FIELD_STOPS, repeatApproval: REPEAT_APPROVAL });
    return;
  }
  if (request.method === "GET" && path === "/api/route/stream") {
    const sessionId = new URL(request.url ?? "/", "http://localhost").searchParams.get("session") ?? "";
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    const unsubscribe = routes.subscribe(sessionId, (snapshot) => response.write(`data: ${JSON.stringify(snapshot)}\n\n`));
    if (!unsubscribe) {
      response.end(`data: ${JSON.stringify({ gone: "This route is no longer running." })}\n\n`);
      return;
    }
    const keepAlive = setInterval(() => response.write(": keep-alive\n\n"), 15_000);
    request.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
    return;
  }
  if (request.method !== "POST") return sendJson(response, 404, { error: "Not found" });
  const body = await readJson(request);

  if (path === "/api/route/start") {
    const parsed = parseFieldStart(body);
    if (!parsed.ok) return sendJson(response, 400, { error: parsed.error });
    try {
      calleClientOptions(parsed.apiKey, calleBaseUrl);
    } catch (error) {
      return sendJson(response, 400, { error: (error as Error).message });
    }
    const phones = parsed.setup.stops.map((stop) => stop.phone);
    const repeats = ledger.alreadyCalled(phones, parsed.setup.utcOffsetMinutes);
    const repeatApproved = body.repeatApproval === REPEAT_APPROVAL;
    if (repeats.length > 0 && !repeatApproved) {
      return sendJson(response, 409, {
        error: `Already called today on this server: ${repeats.join(", ")}. Each customer is called at most once a day.`,
        repeat: repeats,
        approval: REPEAT_APPROVAL,
      });
    }
    const approvedRepeats = new Set(repeatApproved ? phones.filter((phone) => ledger.calledToday(phone, parsed.setup.utcOffsetMinutes)) : []);
    try {
      // A read-only request, so a mistyped key is caught before the rider sets off.
      await calleClient(parsed.apiKey).goals.list({ limit: 1 });
    } catch (error) {
      if (error instanceof CalleAuthenticationError) return sendJson(response, 401, { error: "CALL-E did not accept this API key." });
    }
    try {
      const { sessionId } = routes.create(parsed.apiKey, parsed.setup, approvedRepeats);
      sendJson(response, 200, { sessionId });
    } catch (error) {
      sendJson(response, 503, { error: (error as Error).message });
    }
    return;
  }

  const sessionId = typeof body.session === "string" ? body.session : "";
  const session = routes.get(sessionId);
  if (!session) return sendJson(response, 404, { error: "This route is no longer running." });
  if (path === "/api/route/location") {
    const where = point(body);
    if (!where) return sendJson(response, 400, { error: "Invalid location" });
    const accuracy = typeof body.accuracy === "number" && Number.isFinite(body.accuracy) ? body.accuracy : null;
    session.moveRider(where.lat, where.lng, accuracy);
  } else if (path === "/api/route/finish") {
    const outcome = body.outcome === "nobody_home" ? "nobody_home" : "delivered";
    try {
      session.finishStop(String(body.stopId ?? ""), outcome);
    } catch (error) {
      return sendJson(response, 409, { error: (error as Error).message });
    }
  } else if (path === "/api/route/end") {
    routes.end(sessionId, "You ended the route.");
    return sendJson(response, 200, { ok: true });
  } else {
    return sendJson(response, 404, { error: "Not found" });
  }
  routes.broadcast(sessionId);
  sendJson(response, 200, { ok: true });
}

/**
 * Refuses requests a browser sends from another site, and, while the server
 * listens on loopback, requests that name a non-loopback host (DNS rebinding).
 */
function refuseRequest(request: IncomingMessage): string | null {
  const hostHeader = request.headers.host ?? "";
  if (isLoopbackHost(host)) {
    const name = hostHeader.replace(/:\d+$/, "");
    if (!isLoopbackHost(name)) return "This server only answers on its loopback address.";
  }
  if (request.method === "POST") {
    const origin = request.headers.origin;
    if (origin && origin !== "null") {
      try {
        if (new URL(origin).host !== hostHeader) return "Cross-site request refused.";
      } catch {
        return "Cross-site request refused.";
      }
    }
    if (request.headers["sec-fetch-site"] === "cross-site") return "Cross-site request refused.";
  }
  return null;
}

function parsePace(value: unknown): Pace {
  return typeof value === "string" && value in PACES ? (value as Pace) : "normal";
}

function dayForScreens() {
  const { day, raw } = loaded;
  return {
    city: day.city,
    shiftStart: day.shiftStart,
    merchant: day.merchant,
    hub: day.hub,
    stops: day.stops.map(({ phone, ...stop }) => ({ ...stop, maskedPhone: maskPhone(phone) })),
    shapes: raw.shapes,
    live: {
      available: live.config !== null,
      problem: live.problem,
      consent: CONSENT,
      repeatApproval: REPEAT_APPROVAL,
      targets: [...(live.config?.targets ?? new Map())].map(([stopId, target]) => ({
        stopId,
        maskedPhone: maskPhone(target.phone),
        region: target.region,
      })),
    },
  };
}

function stream(request: IncomingMessage, response: ServerResponse): void {
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  const unsubscribe = controller.subscribe((snapshot) => response.write(`data: ${JSON.stringify(snapshot)}\n\n`));
  const keepAlive = setInterval(() => response.write(": keep-alive\n\n"), 15_000);
  request.on("close", () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let text = "";
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 10_000) throw new Error("Request body too large");
  }
  try {
    const value = JSON.parse(text || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const record = body as { error?: unknown };
  const safe = typeof record?.error === "string" ? { ...record, error: maskPhonesInText(record.error) } : body;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(safe));
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

server.listen(port, host, () => {
  const base = `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`;
  console.log("RouteReady running");
  console.log(`  Showcase (two phones): ${base}/`);
  console.log(`  Rider app:             ${base}/app`);
  console.log(`  Your route, real calls: ${base}/route (bring your own CALL-E key)`);
  if (live.config) {
    const targets = [...live.config.targets].map(([stopId, target]) => `${stopId} -> ${maskPhone(target.phone)} (${target.region})`);
    console.log(`  Live calls: ON for ${targets.join(", ")}; other stops stay scripted`);
    console.log(`  Live start token:      ${startToken}`);
  } else {
    console.log(`  Live calls: off (${live.problem}). Simulated days work without credentials.`);
  }
});
