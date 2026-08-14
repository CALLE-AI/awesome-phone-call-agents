/**
 * Operator dashboard — the demo vehicle.
 *
 * Three exports, one payload shape:
 *
 *  - `buildCaseView(rec, entries)` — a PURE projection of a case record plus
 *    its ledger entries into the JSON the frontend renders. This is the only
 *    place view data is assembled, so the privacy rules live here exactly
 *    once: phone numbers appear exclusively masked to their last four digits,
 *    and party-private intake data (`reservationCents`, `notes`) — including
 *    the ZOPA the engine derives FROM those private bounds — never enters the
 *    payload. No clock, no randomness: identical inputs give identical JSON.
 *
 *  - `startDashboard({dbPath, port})` — a framework-free node:http server that
 *    serves the static frontend plus that same payload straight from the
 *    sqlite ledger. The connection is opened with `query_only`, so the
 *    dashboard can never mutate a case, only observe it.
 *
 *  - `exportStatic({dbPath, caseId, outDir})` — writes the frontend files and
 *    the payload to a flat folder. The result is a complete working site with
 *    no server, no API key, and no network dependency (deployable as-is to
 *    GitHub Pages), replaying the recorded case from `case.json`.
 *
 * Dual-purpose contract with the frontend: `web/app.js` fetches the RELATIVE
 * path "cases.json" and then each listed case's `href`. Live, those resolve
 * to this server ("/cases.json", "api/cases/:id" served from the DB); static,
 * they resolve to the files this module wrote ("cases.json", "case.json").
 * The same frontend bytes run in both worlds — what a judge clicks on the
 * hosted page is what the operator runs locally.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import type {
  CaseRecord,
  CaseState,
  CurvePoint,
  LedgerEntry,
  LedgerEventType,
  OfferKind,
  PartyId,
} from "./types.js";
import { assess } from "./engine.js";
import { rehydrate } from "./state.js";
import { maskPhone } from "./memo.js";
import { computeEntryHash, GENESIS_HASH } from "./ledger.js";

// ---------------------------------------------------------------------------
// View payload types — the wire contract between this module and web/app.js
// ---------------------------------------------------------------------------

export interface CaseViewParty {
  id: PartyId;
  label: string;
  /** ALWAYS masked ("***0001"). The full E.164 number never enters the view. */
  phoneMasked: string;
}

export interface CaseViewRound {
  round: number;
  party: PartyId;
  partyLabel: string;
  kind: OfferKind | null;
  amountCents: number | null;
  conditions: string[];
  publicRationale: string | null;
  /** Verbatim call-transcript quotes backing the recorded offer. */
  evidence: string[];
  callId: string | null;
  outcome: string;
  at: string;
}

export interface CaseViewAttestation {
  party: PartyId;
  callId: string;
  spokenPhrase: string;
  verified: boolean;
  at: string;
}

export interface CaseViewSettlement {
  amountCents: number;
  conditions: string[];
  termsDigest: string;
  attestationPhrase: string;
  attestations: CaseViewAttestation[];
}

/**
 * Engine assessment MINUS the ZOPA. `assess()` estimates the zone of possible
 * agreement from each party's private reservation bound; rendering it would
 * leak those bounds to anyone watching the dashboard, so it is stripped here
 * (the CLI makes the same call — see cmdStatus in cli.ts).
 */
export interface CaseViewAssessment {
  impasse: boolean;
  impasseReason: string | null;
  nextSuggestionCents: number | null;
}

export interface CaseViewLedger {
  entries: number;
  chainOk: boolean;
  brokenAtSeq: number | null;
  headHash: string | null;
}

export interface CaseView {
  kind: "caucus_case_view";
  caseId: string;
  state: CaseState;
  epoch: number;
  createdAt: string;
  updatedAt: string;
  dispute: { vertical: string; summary: string; amountCents: number; currency: string };
  policy: { maxRounds: number };
  parties: CaseViewParty[];
  /** callId of each party's recorded consent call, when one exists. */
  consent: Record<PartyId, string | null>;
  rounds: CaseViewRound[];
  /** Concession curve — one point per recorded monetary offer, both parties. */
  curve: CurvePoint[];
  assessment: CaseViewAssessment;
  settlement: CaseViewSettlement | null;
  ledger: CaseViewLedger;
}

export interface CaseListItem {
  caseId: string;
  state: CaseState;
  vertical: string;
  summary: string;
  amountCents: number;
  rounds: number;
  epoch: number;
  updatedAt: string;
  /** RELATIVE URL of this case's CaseView JSON ("api/cases/:id" or "case.json"). */
  href: string;
}

export interface CaseList {
  kind: "caucus_case_list";
  cases: CaseListItem[];
}

// ---------------------------------------------------------------------------
// Pure chain verification over in-memory entries
// ---------------------------------------------------------------------------

export interface EntriesChainVerification {
  ok: boolean;
  brokenAtSeq?: number;
}

/**
 * Same algorithm as `Ledger.verifyChain`, but over an entries array instead of
 * a live DB handle, so `buildCaseView` stays pure. Uses the ledger module's
 * own exported `computeEntryHash`/`GENESIS_HASH`, so the two verifiers cannot
 * drift apart on what a valid chain is.
 */
export function verifyEntriesChain(
  caseId: string,
  entries: readonly LedgerEntry[],
): EntriesChainVerification {
  let prev = GENESIS_HASH;
  const sorted = entries
    .filter((e) => e.caseId === caseId)
    .slice()
    .sort((a, b) => a.seq - b.seq);
  for (const e of sorted) {
    if (e.prevHash !== prev) return { ok: false, brokenAtSeq: e.seq };
    const expected = computeEntryHash({
      seq: e.seq,
      caseId: e.caseId,
      epoch: e.epoch,
      type: e.type,
      payload: e.payload,
      at: e.at,
      prevHash: prev,
    });
    if (e.hash !== expected) return { ok: false, brokenAtSeq: e.seq };
    prev = e.hash;
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// buildCaseView — the one place view data is assembled
// ---------------------------------------------------------------------------

/**
 * Project a case record + its ledger entries into the dashboard payload.
 *
 * Every field is copied by explicit allowlist — party objects are never
 * spread, so `Party.private` and the raw phone cannot ride along by accident.
 * Entries belonging to other cases are ignored.
 */
export function buildCaseView(rec: CaseRecord, ledgerEntries: readonly LedgerEntry[]): CaseView {
  const entries = ledgerEntries
    .filter((e) => e.caseId === rec.caseId)
    .slice()
    .sort((a, b) => a.seq - b.seq);
  const chain = verifyEntriesChain(rec.caseId, entries);
  const assessment = assess(rec);
  const labelOf = (id: PartyId): string => rec.parties.find((p) => p.id === id)?.label ?? id;

  const consent: Record<PartyId, string | null> = { A: null, B: null };
  for (const e of entries) {
    if (e.type !== "consent_recorded") continue;
    const party = e.payload["party"];
    const callId = e.payload["callId"];
    if ((party === "A" || party === "B") && typeof callId === "string") consent[party] = callId;
  }

  const rounds = [...rec.rounds]
    .sort((a, b) => a.n - b.n)
    .map(
      (r): CaseViewRound => ({
        round: r.n,
        party: r.callee,
        partyLabel: labelOf(r.callee),
        kind: r.offer?.kind ?? null,
        amountCents: r.offer?.amountCents ?? null,
        conditions: [...(r.offer?.conditions ?? [])],
        publicRationale: r.offer?.publicRationale ?? null,
        evidence: [...(r.offer?.evidence ?? [])],
        callId: r.callId ?? null,
        outcome: r.outcome,
        at: r.startedAt,
      }),
    );

  const settlement: CaseViewSettlement | null =
    rec.settlement === undefined
      ? null
      : {
          amountCents: rec.settlement.amountCents,
          conditions: [...rec.settlement.conditions],
          termsDigest: rec.settlement.termsDigest,
          attestationPhrase: rec.settlement.attestationPhrase,
          attestations: (["A", "B"] as const).flatMap((party): CaseViewAttestation[] => {
            const att = rec.settlement?.attestations[party];
            return att === undefined
              ? []
              : [
                  {
                    party,
                    callId: att.callId,
                    spokenPhrase: att.spokenPhrase,
                    verified: att.verified,
                    at: att.at,
                  },
                ];
          }),
        };

  return {
    kind: "caucus_case_view",
    caseId: rec.caseId,
    state: rec.state,
    epoch: rec.epoch,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    dispute: {
      vertical: rec.dispute.vertical,
      summary: rec.dispute.summary,
      amountCents: rec.dispute.amountCents,
      currency: rec.dispute.currency,
    },
    policy: { maxRounds: rec.policy.maxRounds },
    parties: rec.parties.map((p) => ({ id: p.id, label: p.label, phoneMasked: maskPhone(p.phone) })),
    consent,
    rounds,
    curve: assessment.curve.map((c) => ({ round: c.round, party: c.party, amountCents: c.amountCents })),
    assessment: {
      impasse: assessment.impasse,
      impasseReason: assessment.impasseReason ?? null,
      nextSuggestionCents: assessment.nextSuggestionCents ?? null,
      // assessment.zopa is DELIBERATELY not copied — see CaseViewAssessment.
    },
    settlement,
    ledger: {
      entries: entries.length,
      chainOk: chain.ok,
      brokenAtSeq: chain.brokenAtSeq ?? null,
      headHash: entries.at(-1)?.hash ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Ledger DB access (read-only)
// ---------------------------------------------------------------------------

type Db = Database.Database;

interface LedgerRow {
  seq: number;
  case_id: string;
  epoch: number;
  type: string;
  payload: string;
  at: string;
  hash: string;
  prev_hash: string;
}

function openDb(dbPath: string): Db {
  // fileMustExist: a dashboard pointed at a missing DB should say so, not
  // silently create an empty ledger. query_only: this module never writes.
  const db = new Database(dbPath, { fileMustExist: true });
  db.pragma("busy_timeout = 5000");
  db.pragma("query_only = ON");
  return db;
}

function rowToEntry(row: LedgerRow): LedgerEntry {
  return {
    seq: row.seq,
    caseId: row.case_id,
    epoch: row.epoch,
    type: row.type as LedgerEventType,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    at: row.at,
    hash: row.hash,
    prevHash: row.prev_hash,
  };
}

function readEntries(db: Db, caseId: string): LedgerEntry[] {
  const rows = db
    .prepare(
      "SELECT seq, case_id, epoch, type, payload, at, hash, prev_hash FROM ledger WHERE case_id = ? ORDER BY seq ASC",
    )
    .all(caseId) as LedgerRow[];
  return rows.map(rowToEntry);
}

function listCaseIds(db: Db): string[] {
  const rows = db
    .prepare("SELECT case_id AS caseId, MIN(seq) AS firstSeq FROM ledger GROUP BY case_id ORDER BY firstSeq ASC")
    .all() as { caseId: string; firstSeq: number }[];
  return rows.map((r) => r.caseId);
}

function summarize(rec: CaseRecord, href: string): CaseListItem {
  return {
    caseId: rec.caseId,
    state: rec.state,
    vertical: rec.dispute.vertical,
    summary: rec.dispute.summary,
    amountCents: rec.dispute.amountCents,
    rounds: rec.rounds.length,
    epoch: rec.epoch,
    updatedAt: rec.updatedAt,
    href,
  };
}

function listCases(db: Db, hrefPrefix: string): CaseList {
  const cases = listCaseIds(db).map((caseId) => {
    const rec = rehydrate(caseId, readEntries(db, caseId));
    return summarize(rec, `${hrefPrefix}${encodeURIComponent(caseId)}`);
  });
  return { kind: "caucus_case_list", cases };
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

/** Resolves to `<repo>/web/` from both src/ (vitest) and dist/ (tsc build). */
const WEB_DIR = fileURLToPath(new URL("../web/", import.meta.url));

const WEB_ASSETS = ["index.html", "app.js", "styles.css"] as const;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(`${JSON.stringify(body, null, 2)}\n`);
}

function sendAsset(res: ServerResponse, name: (typeof WEB_ASSETS)[number]): void {
  const ext = name.slice(name.lastIndexOf("."));
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
  const body = readFileSync(join(WEB_DIR, name));
  res.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
  res.end(body);
}

function handleRequest(db: Db, req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    sendJson(res, 405, { error: "method not allowed" });
    return;
  }
  const pathname = new URL(req.url ?? "/", "http://caucus.internal").pathname;

  if (pathname === "/" || pathname === "/index.html") return sendAsset(res, "index.html");
  if (pathname === "/app.js") return sendAsset(res, "app.js");
  if (pathname === "/styles.css") return sendAsset(res, "styles.css");

  // Same list at both paths: /cases.json is what the dual-purpose frontend
  // fetches (the static export writes a file of the same name and shape);
  // /api/cases is the documented API route.
  if (pathname === "/cases.json" || pathname === "/api/cases") {
    return sendJson(res, 200, listCases(db, "api/cases/"));
  }

  const caseMatch = /^\/api\/cases\/([^/]+)$/.exec(pathname);
  if (caseMatch !== null) {
    const caseId = decodeURIComponent(caseMatch[1] as string);
    const entries = readEntries(db, caseId);
    if (entries.length === 0) return sendJson(res, 404, { error: `no such case: ${caseId}` });
    return sendJson(res, 200, buildCaseView(rehydrate(caseId, entries), entries));
  }

  sendJson(res, 404, { error: `not found: ${pathname}` });
}

export interface StartDashboardOptions {
  dbPath: string;
  /** 0 (default) lets the OS pick a free port; the resolved value is returned. */
  port?: number;
  host?: string;
}

export interface DashboardServer {
  port: number;
  url: string;
  close(): Promise<void>;
}

/**
 * Serve the dashboard from a sqlite ledger. Resolves once listening, with the
 * actual bound port. `close()` shuts the server and the DB handle and is safe
 * to call more than once.
 */
export function startDashboard(opts: StartDashboardOptions): Promise<DashboardServer> {
  const db = openDb(opts.dbPath);
  const host = opts.host ?? "127.0.0.1";

  const server = createServer((req, res) => {
    try {
      handleRequest(db, req, res);
    } catch (err) {
      // Loud, not pretty: a corrupt ledger or unreadable asset is a 500 with
      // the real message, never a silently empty page.
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  let closed = false;
  const close = (): Promise<void> =>
    new Promise((resolve, reject) => {
      if (closed) {
        resolve();
        return;
      }
      closed = true;
      server.closeAllConnections();
      server.close((err) => {
        db.close();
        if (err) reject(err);
        else resolve();
      });
    });

  return new Promise((resolve, reject) => {
    server.once("error", (err) => {
      db.close();
      reject(err);
    });
    server.listen(opts.port ?? 0, host, () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") {
        void close();
        reject(new Error("startDashboard: server reported no TCP address"));
        return;
      }
      resolve({ port: addr.port, url: `http://${host}:${addr.port}/`, close });
    });
  });
}

// ---------------------------------------------------------------------------
// Static export
// ---------------------------------------------------------------------------

export interface ExportStaticOptions {
  dbPath: string;
  caseId: string;
  outDir: string;
}

export interface ExportStaticResult {
  outDir: string;
  /** Names of the files written into outDir. */
  files: string[];
}

/**
 * Write a self-contained static copy of the dashboard for one case:
 * the three frontend files plus `case.json` (the CaseView payload) and
 * `cases.json` (a one-case list whose href points at `case.json`). The
 * folder works from any static file host — no server code, no API key.
 */
export function exportStatic(opts: ExportStaticOptions): ExportStaticResult {
  const db = openDb(opts.dbPath);
  try {
    const entries = readEntries(db, opts.caseId);
    if (entries.length === 0) {
      throw new Error(`exportStatic: no ledger entries for case "${opts.caseId}" in ${opts.dbPath}`);
    }
    const rec = rehydrate(opts.caseId, entries);
    const view = buildCaseView(rec, entries);

    mkdirSync(opts.outDir, { recursive: true });
    const files: string[] = [];
    for (const name of WEB_ASSETS) {
      copyFileSync(join(WEB_DIR, name), join(opts.outDir, name));
      files.push(name);
    }
    writeFileSync(join(opts.outDir, "case.json"), `${JSON.stringify(view, null, 2)}\n`, "utf8");
    files.push("case.json");
    const list: CaseList = { kind: "caucus_case_list", cases: [summarize(rec, "case.json")] };
    writeFileSync(join(opts.outDir, "cases.json"), `${JSON.stringify(list, null, 2)}\n`, "utf8");
    files.push("cases.json");
    return { outDir: opts.outDir, files };
  } finally {
    db.close();
  }
}
