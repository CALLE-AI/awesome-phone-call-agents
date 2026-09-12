// Local HTTP server: the program dashboard, a JSON state API, a server-sent-events stream of the
// ledger, the CALL-E webhook receiver, and the worklist review endpoint.
//
// The webhook receiver trusts nothing in the payload except the call id. CALL-E deliveries are not
// signed, so it checks CALL-E-Event-Id against the body, de-duplicates, and then re-fetches the call
// through the authenticated API before anything is decided. When a dashboard token is configured
// (always, when a public URL is set for webhooks), every other route requires it.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Config } from "./config.js";
import { Ledger, type LedgerEntry, type Projection } from "./ledger.js";
import { maskPhone } from "./mask.js";
import type { CallInbox } from "./orchestrator.js";
import { buildReport } from "./report.js";
import { languageName } from "./tasks.js";
import type { ExemptionCode, Outcome } from "./types.js";

export interface DrillRequest {
  /** Basename of a sample enrollee file under the data directory. Private files are never listed. */
  registry?: string;
  asOf?: string;
}

export interface ServerContext {
  config: Config;
  inbox: CallInbox;
  publicDir: string;
  registryDir?: string;
  /** Present when the dashboard may start a dry-run drill. Never used for live calls. */
  startDrill?: (request: DrillRequest) => Promise<{ campaignId: string }>;
  isRunning?: () => boolean;
}

export interface ServerHandle {
  url: string;
  port: number;
  server: Server;
  setLedger(ledger: Ledger | null): void;
  close(): Promise<void>;
}

const CAMPAIGN_ID_RE = /^[A-Za-z0-9._-]{1,120}$/;
const TERMINAL = new Set(["completed", "failed", "canceled"]);
const SCREENED: Outcome[] = ["likely_exempt", "likely_meets", "at_risk", "needs_review"];

export function listSampleRegistries(dir: string | undefined): string[] {
  if (!dir || !existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((f) => f.startsWith("enrollees.") && f.endsWith(".csv") && !f.endsWith(".private.csv"))
    .sort();
}

export function listCampaigns(dataDir: string): { campaignId: string; title: string | null; updatedAt: string }[] {
  if (!existsSync(dataDir)) {
    return [];
  }
  const out: { campaignId: string; title: string | null; updatedAt: string }[] = [];
  for (const name of readdirSync(dataDir)) {
    const ledgerPath = join(dataDir, name, "ledger.jsonl");
    if (!CAMPAIGN_ID_RE.test(name) || !existsSync(ledgerPath)) {
      continue;
    }
    let title: string | null = null;
    try {
      const first = readFileSync(ledgerPath, "utf8").split("\n").find((l) => l.trim().length > 0);
      const entry = first ? (JSON.parse(first) as LedgerEntry) : null;
      if (entry?.type === "campaign.declared") {
        title = entry.campaign.title;
      }
    } catch {
      // unreadable ledger: still listed
    }
    out.push({ campaignId: name, title, updatedAt: statSync(ledgerPath).mtime.toISOString() });
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function toPublicState(projection: Projection, mode: Config["mode"], running = false): Record<string, unknown> {
  const states = [...projection.states.values()];
  const count = (o: Outcome): number => states.filter((s) => s.outcome === o).length;
  const calls = [...projection.calls.values()];
  const work = [...projection.work.values()];
  const declaredAt = projection.timeline[0]?.at ?? null;
  const verdicts = states.map((s) => s.classifiedAt).filter((t): t is string => t !== null).sort();
  const last = verdicts[verdicts.length - 1] ?? null;
  const labels = projection.exemptionLabels;
  const exemptionCounts = (Object.keys(labels) as ExemptionCode[])
    .map((code) => ({
      code,
      label: labels[code] ?? code,
      fromCalls: states.filter((s) => s.outcome === "likely_exempt" && s.exemptions.includes(code)).length,
      fromData: states.filter((s) => s.outcome === "cleared_by_data" && s.exemptions.includes(code)).length,
    }))
    .filter((e) => e.fromCalls + e.fromData > 0);
  const languages = new Map<string, { language: string; people: number; screened: number; notAware: number }>();
  for (const s of states) {
    const language = languageName(projection.people.get(s.personId)?.locale ?? "en-US");
    const row = languages.get(language) ?? { language, people: 0, screened: 0, notAware: 0 };
    row.people += 1;
    row.screened += SCREENED.includes(s.outcome as Outcome) ? 1 : 0;
    row.notAware += s.awareBefore === "no" ? 1 : 0;
    languages.set(language, row);
  }
  return {
    campaign: projection.campaign,
    mode: projection.mode ?? mode,
    running,
    closed: projection.closed,
    reportPath: projection.reportPath,
    stateName: projection.stateName,
    callerOrg: projection.callerOrg,
    kpis: {
      people: states.length,
      cleared: count("cleared_by_data"),
      called: states.filter((s) => s.attempts > 0).length,
      screened: states.filter((s) => SCREENED.includes(s.outcome as Outcome)).length,
      awareYes: states.filter((s) => s.awareBefore === "yes").length,
      awareNo: states.filter((s) => s.awareBefore === "no").length,
      likelyExempt: count("likely_exempt"),
      likelyMeets: count("likely_meets"),
      atRisk: count("at_risk"),
      needsReview: count("needs_review"),
      declined: count("declined"),
      optedOut: count("opted_out"),
      identityUnconfirmed: count("identity_unconfirmed"),
      unreachable: count("unreachable"),
      unverified: count("unverified"),
      notAttempted: count("not_attempted"),
      pending: states.filter((s) => s.outcome === null).length,
      pendingCalls: calls.filter((c) => !TERMINAL.has(c.status)).length,
      calls: calls.length,
      work: work.length,
      workNeedsReview: work.filter((w) => w.needsHumanReview && w.reviewedAt === null).length,
      corrections: work.filter((w) => w.kind === "correction_call").length,
      lastResultSeconds: declaredAt && last ? Math.round((Date.parse(last) - Date.parse(declaredAt)) / 1000) : null,
    },
    exemptionCounts,
    languages: [...languages.values()],
    people: states.map((s) => {
      const person = projection.people.get(s.personId);
      return {
        id: s.personId,
        name: person?.name ?? s.personId,
        maskedPhone: maskPhone(person?.phone ?? ""),
        language: languageName(person?.locale ?? "en-US"),
        checkDate: person?.checkDate ?? null,
        daysToCheck: s.daysToCheck,
        priority: s.priority,
        priorityScore: s.priorityScore,
        attempts: s.attempts,
        outcome: s.outcome,
        status: s.outcome ?? (s.nextAction?.type === "await-result" ? "awaiting" : s.attempts > 0 ? "calling" : "pending"),
        reasons: s.reasons,
        exemptions: s.exemptions.map((c) => labels[c] ?? c),
        agentSaid: s.agentSaid,
        correctionNeeded: s.correctionNeeded,
        awareBefore: s.awareBefore,
        wantsNavigator: s.wantsNavigator,
        preferredCallback: s.preferredCallback,
        summary: s.lastSummary,
        evidence: s.evidence,
        nextAction: s.nextAction,
        followUpDueAt: s.followUpDueAt,
      };
    }),
    work: work.map((w) => ({ ...w, personName: projection.people.get(w.personId)?.name ?? w.personId })),
    failedWaves: projection.failedWaves,
    timeline: projection.timeline.slice(-300),
  };
}

function maskEntry(entry: LedgerEntry): unknown {
  if (entry.type === "person.registered") {
    const { phone, birthYear: _birthYear, ...rest } = entry.person;
    return { ...entry, person: { ...rest, phone: maskPhone(phone) } };
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

function json(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), "cache-control": "no-store", ...extra });
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
  const match = (req.headers["cookie"] ?? "").match(/(?:^|;\s*)sc_token=([^;]+)/);
  return match ? decodeURIComponent(match[1] ?? "") : null;
}

export function startServer(ctx: ServerContext): Promise<ServerHandle> {
  let ledger: Ledger | null = null;
  let unsubscribe: (() => void) | null = null;
  const sseClients = new Set<ServerResponse>();
  const seenWebhookIds = new Set<string>();
  const running = (): boolean => ctx.isRunning?.() ?? false;
  const emptyState = (): Record<string, unknown> => ({ campaign: null, mode: ctx.config.mode, running: running(), people: [], kpis: {}, work: [], timeline: [], exemptionCounts: [], languages: [], failedWaves: [] });
  const current = (): Record<string, unknown> => (ledger ? toPublicState(ledger.projection, ctx.config.mode, running()) : emptyState());

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
        broadcast("state", current());
      });
    }
    broadcast("state", current());
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (req.method === "POST" && url.pathname === "/calle/webhook") {
        let body: { id?: unknown; type?: unknown; data?: { id?: unknown } };
        try {
          body = JSON.parse(await readBody(req)) as typeof body;
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
        if (presentedToken(req, url) !== token) {
          json(res, 401, { error: "dashboard token required (Authorization: Bearer <token>, ?token=, or cookie)" });
          return;
        }
        if (url.searchParams.get("token") === token) {
          setCookie["set-cookie"] = `sc_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict`;
        }
      }

      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...setCookie });
        res.end(readFileSync(join(ctx.publicDir, "index.html"), "utf8"));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/state") {
        json(res, 200, current(), setCookie);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/stream") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        res.write(`event: state\ndata: ${JSON.stringify(current())}\n\n`);
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
          json(res, 404, { error: "no active campaign" });
          return;
        }
        // text/plain, not text/markdown: browsers download the latter, and the dashboard's
        // "Outreach report" button should show the report, not drop a file in Downloads.
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
        res.end(buildReport(ledger.projection));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/registries") {
        // Two different reasons a drill cannot be started from the browser, and the operator
        // deserves to know which one applies: live mode refuses on purpose; `run --keep-server`
        // simply has no drill runner attached.
        const drillReason = ctx.config.mode !== "dry-run" ? "live mode" : !ctx.startDrill ? "not available here" : null;
        json(res, 200, { registries: listSampleRegistries(ctx.registryDir), canDrill: drillReason === null, drillReason });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/campaigns") {
        json(res, 200, { campaigns: listCampaigns(ctx.config.dataDir), active: ledger?.projection.campaign?.id ?? null });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/load") {
        const request = JSON.parse((await readBody(req)) || "{}") as { campaignId?: unknown };
        const id = typeof request.campaignId === "string" ? request.campaignId : "";
        const ledgerPath = join(ctx.config.dataDir, id, "ledger.jsonl");
        if (!CAMPAIGN_ID_RE.test(id) || !existsSync(ledgerPath)) {
          json(res, 404, { error: "unknown campaign" });
          return;
        }
        setLedger(new Ledger(ledgerPath));
        json(res, 200, { loaded: id });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/run") {
        if (!ctx.startDrill) {
          json(res, 403, { error: "drills cannot be started from this server" });
          return;
        }
        if (ctx.config.mode !== "dry-run") {
          json(res, 403, { error: "live campaigns are started from the command line with --confirm, never from the dashboard" });
          return;
        }
        const request = JSON.parse((await readBody(req)) || "{}") as DrillRequest;
        if (request.registry !== undefined && !listSampleRegistries(ctx.registryDir).includes(basename(String(request.registry)))) {
          json(res, 400, { error: "registry must be one of the listed sample files" });
          return;
        }
        if (request.asOf !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(request.asOf))) {
          json(res, 400, { error: "asOf must be YYYY-MM-DD" });
          return;
        }
        const started = await ctx.startDrill(request);
        json(res, 202, { started: true, ...started });
        return;
      }
      const review = url.pathname.match(/^\/api\/work\/([A-Za-z0-9_-]+)\/review$/);
      if (req.method === "POST" && review) {
        if (!ledger) {
          json(res, 404, { error: "no active campaign" });
          return;
        }
        const itemId = review[1] ?? "";
        const item = ledger.projection.work.get(itemId);
        if (!item) {
          json(res, 404, { error: "unknown worklist item" });
          return;
        }
        if (item.reviewedAt === null) {
          ledger.append({ type: "work.reviewed", at: new Date().toISOString(), itemId, by: "dashboard caseworker" });
        }
        json(res, 200, { reviewed: true });
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
      const host = ctx.config.host === "0.0.0.0" || ctx.config.host === "::" ? "127.0.0.1" : ctx.config.host;
      resolve({
        url: `http://${host}:${port}`,
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
