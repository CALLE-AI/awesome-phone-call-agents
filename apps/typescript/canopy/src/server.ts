// Local HTTP server: the operator dashboard, a JSON state API, a server-sent-events stream of
// the ledger, the CALL-E webhook receiver, and the dispatch approval endpoint.
//
// The webhook receiver trusts nothing in the payload except the call id. CALL-E deliveries are
// not signed, so the receiver checks CALL-E-Event-Id against the body, de-duplicates, and then
// re-fetches the call through the authenticated API before any decision is made.
//
// When a dashboard token is configured (always, when a public URL is set for webhook delivery),
// every route except the webhook requires it, so a tunnel never exposes the approve or drill
// endpoints to the internet.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Config } from "./config.js";
import { Ledger, type LedgerEntry, type Projection } from "./ledger.js";
import { maskPhone } from "./mask.js";
import type { CallInbox } from "./orchestrator.js";
import { languageName } from "./playbooks.js";
import { buildReport } from "./report.js";
import type { Outcome } from "./types.js";

export interface DrillRequest {
  hazard: string;
  area: string;
  headline?: string;
  /** Basename of a sample registry under the registry directory. Private registries are never listed. */
  registry?: string;
}

export interface ServerContext {
  config: Config;
  inbox: CallInbox;
  publicDir: string;
  /** Directory holding sample registries (data/). Only *.csv that are not *.private.csv are exposed. */
  registryDir?: string;
  /** Present when the dashboard may start a dry-run drill. Never used for live calls. */
  startDrill?: (request: DrillRequest) => Promise<{ eventId: string }>;
  /** True while a roll call is executing in this process, so the dashboard can tell "in flight" from "interrupted". */
  isRunning?: () => boolean;
}

export interface ServerHandle {
  url: string;
  port: number;
  server: Server;
  setLedger(ledger: Ledger | null): void;
  close(): Promise<void>;
}

const EVENT_ID_RE = /^[A-Za-z0-9._-]{1,120}$/;

export function listSampleRegistries(dir: string | undefined): string[] {
  if (!dir || !existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((f) => f.endsWith(".csv") && !f.endsWith(".private.csv"))
    .sort();
}

export function listEvents(dataDir: string): { eventId: string; headline: string | null; area: string | null; updatedAt: string }[] {
  if (!existsSync(dataDir)) {
    return [];
  }
  const events: { eventId: string; headline: string | null; area: string | null; updatedAt: string }[] = [];
  for (const name of readdirSync(dataDir)) {
    const ledgerPath = join(dataDir, name, "ledger.jsonl");
    if (!EVENT_ID_RE.test(name) || !existsSync(ledgerPath)) {
      continue;
    }
    let headline: string | null = null;
    let area: string | null = null;
    try {
      const first = readFileSync(ledgerPath, "utf8").split("\n").find((l) => l.trim().length > 0);
      if (first) {
        const entry = JSON.parse(first) as LedgerEntry;
        if (entry.type === "event.declared") {
          headline = entry.event.headline;
          area = entry.event.area;
        }
      }
    } catch {
      // unreadable ledger: still listed
    }
    events.push({ eventId: name, headline, area, updatedAt: statSync(ledgerPath).mtime.toISOString() });
  }
  return events.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function toPublicState(projection: Projection, mode: Config["mode"], running = false): Record<string, unknown> {
  const states = [...projection.states.values()];
  const count = (o: Outcome): number => states.filter((s) => s.outcome === o).length;
  const reached = count("green") + count("yellow") + count("red");
  const declaredAt = projection.timeline[0]?.at ?? null;
  const verdicts = states.map((s) => s.classifiedAt).filter((t): t is string => t !== null).sort();
  const seconds = (t: string | null): number | null => (declaredAt && t ? Math.round((new Date(t).getTime() - new Date(declaredAt).getTime()) / 1000) : null);
  const pendingCalls = [...projection.calls.values()].filter((c) => !["completed", "failed", "canceled"].includes(c.status)).length;
  return {
    event: projection.event,
    mode: projection.mode ?? mode,
    running,
    closed: projection.closed,
    reportPath: projection.reportPath,
    kpis: {
      people: states.length,
      reached,
      green: count("green"),
      yellow: count("yellow"),
      red: count("red"),
      unreachable: count("unreachable"),
      unverified: count("unverified"),
      notAttempted: count("not_attempted"),
      pending: states.filter((s) => s.outcome === null).length,
      pendingCalls,
      calls: projection.calls.size,
      escalations: [...projection.calls.values()].filter((c) => c.kind === "escalation").length,
      dispatches: projection.dispatches.size,
      reachRate: states.length === 0 ? null : reached / states.length,
      firstVerdictSeconds: seconds(verdicts[0] ?? null),
      lastVerdictSeconds: seconds(verdicts[verdicts.length - 1] ?? null),
    },
    people: states.map((state) => {
      const person = projection.people.get(state.personId);
      const calling = state.outcome === null && state.attempts > 0;
      return {
        id: state.personId,
        name: person?.name ?? state.personId,
        maskedPhone: maskPhone(person?.phone ?? ""),
        language: languageName(person?.locale ?? "en-US"),
        locale: person?.locale ?? null,
        age: person?.age ?? null,
        livesAlone: person?.livesAlone ?? false,
        address: person?.address ?? null,
        lat: person?.lat ?? null,
        lng: person?.lng ?? null,
        priority: state.priority,
        riskScore: state.riskScore,
        attempts: state.attempts,
        outcome: state.outcome,
        status: state.outcome ?? (state.nextAction?.type === "await-result" ? "awaiting" : calling ? "calling" : "pending"),
        agentTier: state.agentTier,
        reasons: state.reasons,
        summary: state.lastSummary,
        evidence: state.evidence,
        nextAction: state.nextAction,
        followUpDueAt: state.followUpDueAt,
        contactName: person?.contactName ?? null,
        contactMaskedPhone: person?.contactPhone ? maskPhone(person.contactPhone) : null,
        contactCalled: state.contactCalled,
        contactResult: state.contactResult,
      };
    }),
    waves: projection.waves,
    failedWaves: projection.failedWaves,
    calls: [...projection.calls.values()],
    dispatches: [...projection.dispatches.values()].map((ticket) => ({ ...ticket, personName: projection.people.get(ticket.personId)?.name ?? ticket.personId })),
    timeline: projection.timeline.slice(-300),
  };
}

function maskEntry(entry: LedgerEntry): unknown {
  if (entry.type === "person.registered") {
    const { phone, contactPhone, ...rest } = entry.person;
    return { ...entry, person: { ...rest, phone: maskPhone(phone), contactPhone: contactPhone ? maskPhone(contactPhone) : null } };
  }
  return entry;
}

async function readBody(req: IncomingMessage, limit = 5 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) {
      throw new Error("Request body too large.");
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function json(res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), "cache-control": "no-store", ...extraHeaders });
  res.end(text);
}

function presentedToken(req: IncomingMessage, url: URL): string | null {
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }
  const query = url.searchParams.get("token");
  if (query) {
    return query;
  }
  const cookie = req.headers["cookie"] ?? "";
  const match = cookie.match(/(?:^|;\s*)canopy_token=([^;]+)/);
  return match ? decodeURIComponent(match[1] ?? "") : null;
}

export function startServer(ctx: ServerContext): Promise<ServerHandle> {
  let ledger: Ledger | null = null;
  let unsubscribe: (() => void) | null = null;
  const sseClients = new Set<ServerResponse>();
  const seenWebhookIds = new Set<string>();
  const running = (): boolean => ctx.isRunning?.() ?? false;
  const emptyState = (): Record<string, unknown> => ({ event: null, mode: ctx.config.mode, running: running(), people: [], kpis: {}, dispatches: [], timeline: [], calls: [], waves: [], failedWaves: [] });

  const broadcast = (event: string, data: unknown): void => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      client.write(frame);
    }
  };

  const setLedger = (next: Ledger | null): void => {
    unsubscribe?.();
    unsubscribe = null;
    ledger = next;
    if (ledger) {
      const current = ledger;
      unsubscribe = current.subscribe((entry) => {
        broadcast("entry", maskEntry(entry));
        broadcast("state", toPublicState(current.projection, ctx.config.mode, running()));
      });
    }
    broadcast("state", ledger ? toPublicState(ledger.projection, ctx.config.mode, running()) : emptyState());
  };

  const indexHtml = (): string => readFileSync(join(ctx.publicDir, "index.html"), "utf8");

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (req.method === "POST" && url.pathname === "/calle/webhook") {
        const raw = await readBody(req);
        let body: { id?: unknown; type?: unknown; data?: { id?: unknown } };
        try {
          body = JSON.parse(raw) as typeof body;
        } catch {
          json(res, 400, { error: "invalid json" });
          return;
        }
        const headerId = req.headers["call-e-event-id"];
        if (typeof body.id !== "string" || typeof headerId !== "string" || headerId !== body.id) {
          json(res, 400, { error: "CALL-E-Event-Id header must match body.id" });
          return;
        }
        if (seenWebhookIds.has(body.id)) {
          json(res, 200, { received: true, duplicate: true });
          return;
        }
        seenWebhookIds.add(body.id);
        const callId = typeof body.data?.id === "string" ? body.data.id : null;
        if (callId !== null) {
          ledger?.note("info", `Webhook ${String(body.type)} received for ${callId}; re-fetching the call before acting on it`);
          ctx.inbox.deliver(callId);
        }
        json(res, 200, { received: true });
        return;
      }

      const token = ctx.config.dashboardToken;
      const setCookie: Record<string, string> = {};
      if (token !== null) {
        const presented = presentedToken(req, url);
        if (presented !== token) {
          json(res, 401, { error: "dashboard token required (Authorization: Bearer <token>, ?token=, or cookie)" });
          return;
        }
        if (url.searchParams.get("token") === token) {
          setCookie["set-cookie"] = `canopy_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict`;
        }
      }

      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        const html = indexHtml();
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...setCookie });
        res.end(html);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/state") {
        json(res, 200, ledger ? toPublicState(ledger.projection, ctx.config.mode, running()) : emptyState(), setCookie);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/stream") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        res.write(`event: state\ndata: ${JSON.stringify(ledger ? toPublicState(ledger.projection, ctx.config.mode) : emptyState())}\n\n`);
        sseClients.add(res);
        const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), 15000);
        req.on("close", () => {
          clearInterval(keepAlive);
          sseClients.delete(res);
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/report") {
        if (!ledger) {
          json(res, 404, { error: "no active event" });
          return;
        }
        const markdown = buildReport(ledger.projection);
        res.writeHead(200, { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" });
        res.end(markdown);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/registries") {
        json(res, 200, { registries: listSampleRegistries(ctx.registryDir), canDrill: Boolean(ctx.startDrill) && ctx.config.mode === "dry-run" });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/events") {
        json(res, 200, { events: listEvents(ctx.config.dataDir), active: ledger?.projection.event?.id ?? null });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/load") {
        const request = JSON.parse((await readBody(req)) || "{}") as { eventId?: unknown };
        const eventId = typeof request.eventId === "string" ? request.eventId : "";
        const ledgerPath = join(ctx.config.dataDir, eventId, "ledger.jsonl");
        if (!EVENT_ID_RE.test(eventId) || !existsSync(ledgerPath)) {
          json(res, 404, { error: "unknown event" });
          return;
        }
        setLedger(new Ledger(ledgerPath));
        json(res, 200, { loaded: eventId });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/run") {
        if (!ctx.startDrill) {
          json(res, 403, { error: "drills cannot be started from this server" });
          return;
        }
        if (ctx.config.mode !== "dry-run") {
          json(res, 403, { error: "live runs are started from the command line with --confirm, never from the dashboard" });
          return;
        }
        const request = JSON.parse((await readBody(req)) || "{}") as DrillRequest;
        if (typeof request.hazard !== "string" || typeof request.area !== "string") {
          json(res, 400, { error: "hazard and area are required" });
          return;
        }
        if (request.registry !== undefined) {
          const allowed = listSampleRegistries(ctx.registryDir);
          if (typeof request.registry !== "string" || !allowed.includes(basename(request.registry))) {
            json(res, 400, { error: "registry must be one of the listed sample registries" });
            return;
          }
          request.registry = basename(request.registry);
        }
        const started = await ctx.startDrill(request);
        json(res, 202, { started: true, ...started });
        return;
      }
      const approve = url.pathname.match(/^\/api\/dispatch\/([A-Za-z0-9_-]+)\/approve$/);
      if (req.method === "POST" && approve) {
        if (!ledger) {
          json(res, 404, { error: "no active event" });
          return;
        }
        const ticketId = approve[1] ?? "";
        const ticket = ledger.projection.dispatches.get(ticketId);
        if (!ticket) {
          json(res, 404, { error: "unknown ticket" });
          return;
        }
        if (ticket.approvedAt === null) {
          ledger.append({ type: "dispatch.approved", at: new Date().toISOString(), ticketId, by: "dashboard operator" });
        }
        json(res, 200, { approved: true });
        return;
      }
      json(res, 404, { error: `no route for ${req.method} ${url.pathname}` });
    } catch (err) {
      json(res, 500, { error: (err as Error).message });
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(ctx.config.port, ctx.config.host, () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : ctx.config.port;
      const hostForUrl = ctx.config.host === "0.0.0.0" || ctx.config.host === "::" ? "127.0.0.1" : ctx.config.host;
      resolve({
        url: `http://${hostForUrl}:${port}`,
        port,
        server,
        setLedger,
        close: () =>
          new Promise<void>((done) => {
            unsubscribe?.();
            for (const client of sseClients) {
              client.end();
            }
            sseClients.clear();
            server.close(() => done());
          }),
      });
    });
  });
}
