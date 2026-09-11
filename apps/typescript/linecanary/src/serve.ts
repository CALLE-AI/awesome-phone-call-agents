/**
 * The dashboard server: three routes, state rebuilt from disk per request
 * (baseline files are small and the runner may append between requests).
 * Loopback by default — the dashboard shows masked numbers only, but it is
 * still an operator surface, not a public one. The public artifact is the
 * status page, which renders no tasks and no transcripts.
 */

import { timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { openStore } from "./baseline.js";
import { ConfigError, type Config } from "./config.js";
import { renderCheckLog, renderDashboard, renderNotFound, renderStatus } from "./pages.js";
import { buildDashboardState } from "./state.js";

export interface DashboardServer {
  port: number;
  close(): Promise<void>;
}

export interface DashboardOptions {
  port: number;
  host?: string;
  statusTitle?: string;
  /**
   * When set, operator surfaces (dashboard, call logs, JSON state) require
   * HTTP Basic auth with this password (any username). The public status
   * pages stay open — they are the client-facing artifact.
   */
  password?: string;
}

function authorized(header: string | undefined, password: string): boolean {
  if (header === undefined || !header.startsWith("Basic ")) {
    return false;
  }
  const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
  const supplied = Buffer.from(decoded.slice(decoded.indexOf(":") + 1));
  const expected = Buffer.from(password);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

export function startDashboard(config: Config, options: DashboardOptions): Promise<DashboardServer> {
  const host = options.host ?? "127.0.0.1";
  // A blank password is not a password: treat it as absent so the bind guard
  // below fires and the auth comparison can never succeed on empty credentials.
  const password = options.password === undefined || options.password.length === 0 ? undefined : options.password;
  if (!LOOPBACK.has(host) && password === undefined) {
    // Operator surfaces carry full transcripts. Binding them beyond loopback
    // without a password would publish them; refuse rather than expose.
    throw new ConfigError(
      `Refusing to bind the operator dashboard to ${host} without a password. ` +
        "Set LINECANARY_DASHBOARD_PASSWORD, or bind to 127.0.0.1. The public status pages are the only unauthenticated surface.",
    );
  }
  // Greeting-code lines show their code in the unverified hint; other
  // ownership methods get the attestation instruction instead.
  const ownershipCodes: Record<string, string | null> = Object.fromEntries(
    config.lines.map((line) => [line.id, line.ownership.method === "greeting_code" ? line.ownership.code : null]),
  );
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const isPublic = url.pathname === "/status" || url.pathname.startsWith("/status/");
    if (password !== undefined && !isPublic && !authorized(request.headers.authorization, password)) {
      response.statusCode = 401;
      response.setHeader("WWW-Authenticate", 'Basic realm="LineCanary operator"');
      response.setHeader("content-type", "text/plain");
      response.end("The operator dashboard requires the password. The public status pages at /status do not.");
      return;
    }
    const store = openStore(config.baselineDir);
    const state = buildDashboardState(config, store);

    if (url.pathname === "/api/state") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(state));
      return;
    }
    if (url.pathname === "/status") {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(renderStatus(state, options.statusTitle));
      return;
    }
    const statusMatch = /^\/status\/([^/]+)$/.exec(url.pathname);
    if (statusMatch !== null) {
      const lineId = decodeURIComponent(statusMatch[1]);
      const line = state.lines.find((candidate) => candidate.id === lineId);
      if (line === undefined) {
        response.statusCode = 404;
        response.setHeader("content-type", "text/html; charset=utf-8");
        response.end(renderNotFound("Line not found", `No line named ${lineId}.`));
        return;
      }
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(renderStatus(state, line.name, lineId));
      return;
    }
    if (url.pathname === "/") {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(renderDashboard(state, ownershipCodes));
      return;
    }
    const checkMatch = /^\/check\/([^/]+)$/.exec(url.pathname);
    if (checkMatch !== null) {
      const checkId = decodeURIComponent(checkMatch[1]);
      for (const line of state.lines) {
        const check = line.checks.find((candidate) => candidate.id === checkId);
        if (check !== undefined) {
          response.setHeader("content-type", "text/html; charset=utf-8");
          response.end(renderCheckLog(line, check, state.generatedAt, config.historyLimit, state.timezone));
          return;
        }
      }
      response.statusCode = 404;
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(renderNotFound("Check not found", `No check named ${checkId}.`));
      return;
    }
    response.statusCode = 404;
    response.setHeader("content-type", "text/plain");
    response.end("Not found. Routes: / (dashboard), /check/<id> (call log), /status (all lines), /status/<line-id> (one line), /api/state (JSON).");
  });

  return new Promise((resolve) => {
    server.listen(options.port, host, () => {
      const address = server.address() as AddressInfo;
      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}
