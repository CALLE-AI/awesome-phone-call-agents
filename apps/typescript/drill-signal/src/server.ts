/**
 * HTTP server and API routes for DrillSignal.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { resolvePublicDirectory } from "./public-dir.js";
import {
  assertOperatorAuthConfigured,
  defaultPort,
  liveReady,
  mutatingApiRequiresAuth,
  serverBindHost,
  serverOperatorToken,
} from "./config.js";
import { FileLaunchClaimStore, JsonDrillStore } from "./store.js";
import * as service from "./service.js";
import { ensureEmbeddedFakeBaseUrl } from "./embedded-fake.js";
import type { CreateDrillBody, LaunchBody, PreviewAckBody } from "./types.js";

const resolvedPublicDir = resolvePublicDirectory(import.meta.url);

function createServiceDeps() {
  const dataDir = process.env.DRILL_SIGNAL_DATA_DIR ?? join(process.cwd(), ".data");
  return {
    store: new JsonDrillStore(dataDir),
    claims: new FileLaunchClaimStore(dataDir),
  };
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length === 0) return {};
  return JSON.parse(raw) as unknown;
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function sendError(response: ServerResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const status = message.toLowerCase().includes("not found")
    ? 404
    : message.toLowerCase().includes("unauthorized") || message.toLowerCase().includes("operator token")
      ? 401
      : 400;
  sendJson(response, status, { error: message });
}

function authorizeMutating(request: IncomingMessage): void {
  if (!mutatingApiRequiresAuth()) {
    return;
  }
  const expected = serverOperatorToken();
  if (!expected) {
    throw new Error("Operator token is not configured on the server.");
  }
  const header = request.headers.authorization ?? "";
  if (header !== `Bearer ${expected}`) {
    throw new Error("Unauthorized — operator bearer token required for mutating API routes.");
  }
}

function serveStatic(pathname: string, response: ServerResponse): boolean {
  const normalized = pathname === "/" ? "/index.html" : pathname.replace(/\\/g, "/");
  if (normalized.includes("..")) {
    return false;
  }
  const relative = normalized.startsWith("/") ? normalized.slice(1) : normalized;
  const filePath = resolve(resolvedPublicDir, relative);
  const prefix = resolvedPublicDir.endsWith(sep) ? resolvedPublicDir : `${resolvedPublicDir}${sep}`;
  if (!filePath.startsWith(prefix) || !existsSync(filePath)) {
    return false;
  }
  const ext = extname(filePath);
  response.statusCode = 200;
  response.setHeader("content-type", MIME[ext] ?? "application/octet-stream");
  response.end(readFileSync(filePath));
  return true;
}

function isMutatingRoute(method: string | undefined, pathname: string): boolean {
  if (method !== "POST") {
    return false;
  }
  return pathname === "/api/drills" || /^\/api\/drills\/[^/]+\/(preview|launch|cancel)$/.test(pathname);
}

export function createAppServer() {
  const deps = createServiceDeps();
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    try {
      if (isMutatingRoute(request.method, url.pathname)) {
        authorizeMutating(request);
      }
      if (request.method === "GET" && url.pathname === "/api/health") {
        sendJson(response, 200, {
          ok: true,
          defaultMode: "simulation",
          authRequired: mutatingApiRequiresAuth(),
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/presets") {
        sendJson(response, 200, {
          presets: [
            "primary-success",
            "primary-unavailable-backup-success",
            "opt-out",
            "malformed-result",
            "timeout-unknown",
            "cancellation",
          ],
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/config") {
        const configuredFake = process.env.CALLE_BASE_URL;
        const fakeReady =
          Boolean(configuredFake && configuredFake !== "http://127.0.0.1:0") ||
          process.env.DRILL_SIGNAL_EMBEDDED_FAKE !== "0";
        sendJson(response, 200, {
          authRequired: mutatingApiRequiresAuth(),
          fakeServerReady: fakeReady,
          embeddedFakeAvailable: process.env.DRILL_SIGNAL_EMBEDDED_FAKE !== "0",
          liveReady: liveReady(),
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/drills") {
        const body = (await readBody(request)) as CreateDrillBody;
        if (body.mode === "live" && !liveReady()) {
          sendJson(response, 400, {
            error:
              "Live mode is not ready. Configure CALLE_API_KEY on the server and restart, then try again.",
          });
          return;
        }
        const drill = service.createDrill(deps, body);
        sendJson(response, 201, service.publicDrillView(drill));
        return;
      }
      const drillMatch = /^\/api\/drills\/([^/]+)(?:\/(preview|launch|cancel))?$/.exec(url.pathname);
      if (drillMatch) {
        const id = drillMatch[1];
        const action = drillMatch[2];
        if (request.method === "GET" && !action) {
          const drill = service.getDrill(deps, id);
          if (!drill) {
            sendJson(response, 404, { error: "Drill not found." });
            return;
          }
          sendJson(response, 200, service.publicDrillView(drill));
          return;
        }
        if (request.method === "GET" && action === "preview") {
          sendJson(response, 200, service.getPreview(deps, id));
          return;
        }
        if (request.method === "POST" && action === "preview") {
          const body = (await readBody(request)) as PreviewAckBody;
          const drill = service.acknowledgePreview(deps, id, body);
          sendJson(response, 200, service.publicDrillView(drill));
          return;
        }
        if (request.method === "POST" && action === "launch") {
          const body = (await readBody(request)) as LaunchBody;
          let fakeBaseUrl: string | undefined;
          const drill = service.getDrill(deps, id);
          if (
            drill?.mode === "fake-server" &&
            (!process.env.CALLE_BASE_URL || process.env.CALLE_BASE_URL === "http://127.0.0.1:0")
          ) {
            if (process.env.DRILL_SIGNAL_EMBEDDED_FAKE === "0") {
              sendJson(response, 400, {
                error:
                  "fake-server mode requires CALLE_BASE_URL or embedded fake provider. Set CALLE_BASE_URL or enable embedded fake.",
              });
              return;
            }
            fakeBaseUrl = await ensureEmbeddedFakeBaseUrl();
          }
          const finished = await service.launchDrill(deps, id, body, { fakeBaseUrl });
          sendJson(response, 200, service.publicDrillView(finished));
          return;
        }
        if (request.method === "POST" && action === "cancel") {
          const drill = service.cancelDrill(deps, id);
          sendJson(response, 200, service.publicDrillView(drill));
          return;
        }
      }
      if (request.method === "GET" && serveStatic(url.pathname, response)) {
        return;
      }
      sendJson(response, 404, { error: "Not found." });
    } catch (error) {
      sendError(response, error);
    }
  });
}

export function startServer(port = defaultPort(), host = serverBindHost()) {
  assertOperatorAuthConfigured();
  const server = createAppServer();
  server.listen(port, host, () => {
    const authNote = mutatingApiRequiresAuth() ? " (mutating APIs require operator bearer token)" : "";
    console.log(`DrillSignal listening on http://${host}:${port} (default mode: simulation, no network)${authNote}`);
  });
  return server;
}

const isMain = process.argv[1]?.includes("server");
if (isMain) {
  startServer();
}
