// RouteReady web server: the rider app at /app, a two-phone showcase at /.
// Simulated days need no credentials. Live calls are off unless configured,
// and a live day can only be started with the token printed at startup.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { loadDay } from "../core/day.js";
import { maskPhone } from "../core/phone.js";
import { loadLiveConfig } from "./config.js";
import { PACES, RunController, type Mode, type Pace } from "./run.js";

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
};
const CONSENT = "Every live number belongs to me or to someone who agreed to take these calls.";

const host = process.env.HOST?.trim() || "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
const loaded = loadDay();
const live = loadLiveConfig(process.env, loaded.day);
const startToken = process.env.ROUTEREADY_TOKEN?.trim() || randomBytes(9).toString("base64url");
const controller = new RunController(loaded, live.config);

const server = createServer((request, response) => {
  handle(request, response).catch((error: Error) => sendJson(response, 500, { error: error.message }));
});

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;

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
  if (request.method === "POST" && path === "/api/run") {
    const body = await readJson(request);
    const mode: Mode = body.mode === "live" ? "live" : "simulate";
    if (mode === "live") {
      if (!live.config) return sendJson(response, 400, { error: `Live mode unavailable: ${live.problem}` });
      if (!sameSecret(String(body.token ?? ""), startToken)) return sendJson(response, 403, { error: "Wrong start token." });
      if (body.consent !== CONSENT) return sendJson(response, 400, { error: "Confirm that every live number agreed to take these calls." });
    }
    try {
      await controller.start(mode, parsePace(body.pace));
    } catch (error) {
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
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
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
  if (live.config) {
    const targets = [...live.config.targets].map(([stopId, target]) => `${stopId} -> ${maskPhone(target.phone)} (${target.region})`);
    console.log(`  Live calls: ON for ${targets.join(", ")}; other stops stay scripted`);
    console.log(`  Live start token:      ${startToken}`);
  } else {
    console.log(`  Live calls: off (${live.problem}). Simulated days work without credentials.`);
  }
});
