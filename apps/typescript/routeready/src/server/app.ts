// RouteReady web server: dispatcher console at /, rider screen at /rider.
// Simulated days need no credentials. Live calls are off unless configured,
// and a live day can only be started with the token printed at startup.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { loadDay } from "../core/day.js";
import { maskPhone } from "../core/phone.js";
import { loadLiveConfig } from "./config.js";
import { RunController, type Mode } from "./run.js";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env file: use the shell environment.
}

const WEB_DIR = new URL("../../web/", import.meta.url);
const PAGES: Record<string, [file: string, type: string]> = {
  "/": ["dispatcher.html", "text/html; charset=utf-8"],
  "/rider": ["rider.html", "text/html; charset=utf-8"],
  "/dispatcher.js": ["dispatcher.js", "text/javascript; charset=utf-8"],
  "/rider.js": ["rider.js", "text/javascript; charset=utf-8"],
  "/shared.js": ["shared.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
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
    const speed = clamp(Number(body.speed) || 0.75, 0.1, 5);
    if (mode === "live") {
      if (!live.config) return sendJson(response, 400, { error: `Live mode unavailable: ${live.problem}` });
      if (!sameSecret(String(body.token ?? ""), startToken)) return sendJson(response, 403, { error: "Wrong start token." });
      if (body.consent !== CONSENT) return sendJson(response, 400, { error: "Confirm that every live number agreed to take these calls." });
    }
    try {
      await controller.start(mode, speed);
    } catch (error) {
      return sendJson(response, 409, { error: (error as Error).message });
    }
    sendJson(response, 200, { ok: true, mode });
    return;
  }
  if (request.method === "POST" && path === "/api/stop") {
    controller.stop();
    sendJson(response, 200, { ok: true });
    return;
  }
  sendJson(response, 404, { error: "Not found" });
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

server.listen(port, host, () => {
  const base = `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`;
  console.log(`RouteReady running`);
  console.log(`  Dispatcher console: ${base}/`);
  console.log(`  Rider screen:       ${base}/rider`);
  if (live.config) {
    const targets = [...live.config.targets].map(([stopId, target]) => `${stopId} -> ${maskPhone(target.phone)} (${target.region})`);
    console.log(`  Live calls: ON for ${targets.join(", ")}; other stops stay scripted`);
    console.log(`  Live start token:   ${startToken}`);
  } else {
    console.log(`  Live calls: off (${live.problem}). Simulated days work without credentials.`);
  }
});
