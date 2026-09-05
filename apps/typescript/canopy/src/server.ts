// Local HTTP server: the operator dashboard, a JSON state API, a server-sent-events stream of
// the ledger, the CALL-E webhook receiver, and the dispatch approval endpoint.
//
// The webhook receiver trusts nothing in the payload except the call id. CALL-E deliveries are
// not signed, so the receiver checks CALL-E-Event-Id against the body, de-duplicates, and then
// re-fetches the call through the authenticated API before any decision is made.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.js";
import type { Ledger, LedgerEntry, Projection } from "./ledger.js";
import { maskPhone } from "./mask.js";
import type { CallInbox } from "./orchestrator.js";
import { languageName } from "./playbooks.js";
import { buildReport } from "./report.js";
import type { Outcome } from "./types.js";

export interface DrillRequest {
  hazard: string;
  area: string;
  headline?: string;
  registry?: string;
}

export interface ServerContext {
  config: Config;
  inbox: CallInbox;
  publicDir: string;
  /** Present when the dashboard may start a dry-run drill. Never used for live calls. */
  startDrill?: (request: DrillRequest) => Promise<{ eventId: string }>;
}

export interface ServerHandle {
  url: string;
  port: number;
  server: Server;
  setLedger(ledger: Ledger | null): void;
  close(): Promise<void>;
}

export function toPublicState(projection: Projection, mode: Config["mode"]): Record<string, unknown> {
  const states = [...projection.states.values()];
  const count = (o: Outcome): number => states.filter((s) => s.outcome === o).length;
  const reached = count("green") + count("yellow") + count("red");
  const declaredAt = projection.timeline[0]?.at ?? null;
  const verdicts = states.map((s) => s.classifiedAt).filter((t): t is string => t !== null).sort();
  const seconds = (t: string | null): number | null => (declaredAt && t ? Math.round((new Date(t).getTime() - new Date(declaredAt).getTime()) / 1000) : null);
  return {
    event: projection.event,
    mode: projection.mode ?? mode,
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
      pending: states.filter((s) => s.outcome === null).length,
      calls: projection.calls.size,
      escalations: [...projection.calls.values()].filter((c) => c.kind === "escalation").length,
      dispatches: projection.dispatches.size,
      reachRate: states.length === 0 ? null : reached / states.length,
      firstVerdictSeconds: seconds(verdicts[0] ?? null),
      lastVerdictSeconds: seconds(verdicts[verdicts.length - 1] ?? null),
    },
    people: states.map((state) => {
      const person = projection.people.get(state.personId);
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

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), "cache-control": "no-store" });
  res.end(text);
}

export function startServer(ctx: ServerContext): Promise<ServerHandle> {
  let ledger: Ledger | null = null;
  let unsubscribe: (() => void) | null = null;
  const sseClients = new Set<ServerResponse>();
  const seenWebhookIds = new Set<string>();

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
      unsubscribe = ledger.subscribe((entry) => {
        broadcast("entry", maskEntry(entry));
        broadcast("state", toPublicState(ledger!.projection, ctx.config.mode));
      });
    }
    broadcast("state", ledger ? toPublicState(ledger.projection, ctx.config.mode) : { event: null, mode: ctx.config.mode, people: [], kpis: {}, dispatches: [], timeline: [] });
  };

  const indexHtml = (): string => readFileSync(join(ctx.publicDir, "index.html"), "utf8");

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        const html = indexHtml();
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        res.end(html);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/state") {
        json(res, 200, ledger ? toPublicState(ledger.projection, ctx.config.mode) : { event: null, mode: ctx.config.mode, people: [], kpis: {}, dispatches: [], timeline: [] });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/stream") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        res.write(`event: state\ndata: ${JSON.stringify(ledger ? toPublicState(ledger.projection, ctx.config.mode) : { event: null, mode: ctx.config.mode, people: [], kpis: {}, dispatches: [], timeline: [] })}\n\n`);
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
    server.listen(ctx.config.port, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : ctx.config.port;
      resolve({
        url: `http://127.0.0.1:${port}`,
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
