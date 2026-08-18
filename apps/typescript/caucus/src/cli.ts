/**
 * Caucus operator CLI.
 *
 *   caucus open   --vertical security_deposit --summary "..." --amount 1200 \
 *                 --party-a "Landlord:+15550000001" --party-b "Tenant:+15550000002"
 *   caucus status <caseId>
 *   caucus run    <caseId> --step [--live]
 *   caucus verify <caseId>
 *   caucus memo   <caseId> --out memo.md [--json memo.json]
 *
 * Thin command handlers over the store / state / calle / engine / memo
 * modules. Collaborator modules are resolved lazily via dynamic import so the
 * CLI stays decoupled from their load order; tests inject `CliDeps` directly.
 *
 * SAFETY: the CALL-E client is ALWAYS a mock unless BOTH `--live` is passed
 * AND `CALLE_API_KEY` is set. There is no other path to a real dial, and
 * `open` performs no dialing at all — consent calls come first, via `run`.
 */

import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import process from "node:process";

import type {
  CalleClient,
  CallResult,
  CaseRecord,
  CasePolicy,
  LedgerEntry,
  LedgerEventType,
  Party,
} from "./types.js";
import { RealCalleClient, classifyCall, extractRelayedDollars } from "./calle.js";
import { verifySpokenPhrase } from "./attest.js";
import { pendingWork, runStep as runnerRunStep } from "./runner.js";
import { createCase, genesisEvent, isTerminal } from "./state.js";
import { openStore as realOpenStore, verifyEntries, type LedgerStore } from "./store.js";
import type { Ledger } from "./ledger.js";

// ---------- Argument parsing (pure — unit tested) ----------

export class CliUsageError extends Error {}

export interface PartyInput {
  label: string;
  phone: string;
}

export type CliCommand =
  | {
      cmd: "open";
      db: string;
      vertical: string;
      summary: string;
      amountCents: number;
      partyA: PartyInput;
      partyB: PartyInput;
      maxRounds: number;
    }
  | { cmd: "status"; db: string; caseId: string }
  | { cmd: "run"; db: string; caseId: string; step: boolean; live: boolean; mock: boolean }
  | { cmd: "verify"; db: string; caseId: string }
  | { cmd: "memo"; db: string; caseId: string; out: string; json?: string }
  | { cmd: "help" };

const USAGE = [
  "usage: caucus <command> [options]   (global: --db <path>, --mock)",
  "",
  "  open    --vertical <v> --summary <s> --amount <dollars>",
  "          --party-a 'Label:+1555...' --party-b 'Label:+1555...' [--max-rounds n]",
  "  status  <caseId>",
  "  run     <caseId> --step [--live]   (mock client unless --live AND CALLE_API_KEY)",
  "  verify  <caseId>                   (ledger chain + attestations; exit 0/1)",
  "  memo    <caseId> [--out memo.md] [--json memo.json]",
].join("\n");

const E164 = /^\+[1-9]\d{6,14}$/;

/** Parse "Label:+15550000001" (label may itself contain colons). */
export function parseParty(raw: string, flag: string): PartyInput {
  const idx = raw.lastIndexOf(":");
  const label = idx > 0 ? raw.slice(0, idx).trim() : "";
  const phone = idx > 0 ? raw.slice(idx + 1).trim() : "";
  if (label.length === 0 || !E164.test(phone)) {
    throw new CliUsageError(
      `${flag} must be "Label:+1XXXXXXXXXX" (E.164 phone); got "${raw}"`,
    );
  }
  return { label, phone };
}

/** Parse a dollar amount ("1200" or "1200.50") into integer cents. */
export function parseAmountToCents(raw: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (m === null) {
    throw new CliUsageError(`--amount must be a positive dollar amount; got "${raw}"`);
  }
  const cents =
    Number(m[1]) * 100 + (m[2] === undefined ? 0 : Number(m[2].padEnd(2, "0")));
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new CliUsageError(`--amount out of range: "${raw}"`);
  }
  return cents;
}

function requireOption(
  values: Record<string, unknown>,
  name: string,
): string {
  const v = values[name];
  if (typeof v !== "string" || v.length === 0) {
    throw new CliUsageError(`missing required option --${name}`);
  }
  return v;
}

function requireCaseId(positionals: string[], cmd: string): string {
  const id = positionals[0];
  if (id === undefined || id.length === 0) {
    throw new CliUsageError(`usage: caucus ${cmd} <caseId>`);
  }
  return id;
}

/** Parse argv (without node/script prefix) into a command descriptor. */
export function parseCliArgs(argv: readonly string[]): CliCommand {
  const [sub, ...rest] = argv;
  if (sub === undefined || sub === "help" || sub === "--help") {
    return { cmd: "help" };
  }

  const globalOptions = {
    db: { type: "string" as const, default: "./caucus.db" },
    mock: { type: "boolean" as const, default: false },
  };

  switch (sub) {
    case "open": {
      const { values } = parseArgs({
        args: [...rest],
        options: {
          ...globalOptions,
          vertical: { type: "string" as const },
          summary: { type: "string" as const },
          amount: { type: "string" as const },
          "party-a": { type: "string" as const },
          "party-b": { type: "string" as const },
          "max-rounds": { type: "string" as const, default: "8" },
        },
        allowPositionals: false,
      });
      const maxRounds = Number(values["max-rounds"]);
      if (!Number.isInteger(maxRounds) || maxRounds < 1) {
        throw new CliUsageError(`--max-rounds must be a positive integer`);
      }
      return {
        cmd: "open",
        db: values.db,
        vertical: requireOption(values, "vertical"),
        summary: requireOption(values, "summary"),
        amountCents: parseAmountToCents(requireOption(values, "amount")),
        partyA: parseParty(requireOption(values, "party-a"), "--party-a"),
        partyB: parseParty(requireOption(values, "party-b"), "--party-b"),
        maxRounds,
      };
    }
    case "status":
    case "verify": {
      const { values, positionals } = parseArgs({
        args: [...rest],
        options: globalOptions,
        allowPositionals: true,
      });
      return { cmd: sub, db: values.db, caseId: requireCaseId(positionals, sub) };
    }
    case "run": {
      const { values, positionals } = parseArgs({
        args: [...rest],
        options: {
          ...globalOptions,
          step: { type: "boolean" as const, default: false },
          live: { type: "boolean" as const, default: false },
        },
        allowPositionals: true,
      });
      return {
        cmd: "run",
        db: values.db,
        caseId: requireCaseId(positionals, "run"),
        step: values.step,
        live: values.live,
        mock: values.mock,
      };
    }
    case "memo": {
      const { values, positionals } = parseArgs({
        args: [...rest],
        options: {
          ...globalOptions,
          out: { type: "string" as const, default: "memo.md" },
          json: { type: "string" as const },
        },
        allowPositionals: true,
      });
      const parsed: CliCommand = {
        cmd: "memo",
        db: values.db,
        caseId: requireCaseId(positionals, "memo"),
        out: values.out,
      };
      if (values.json !== undefined) parsed.json = values.json;
      return parsed;
    }
    default:
      throw new CliUsageError(`unknown command "${sub}"\n${USAGE}`);
  }
}

// ---------- Dependency surface (injected in tests, resolved lazily in prod) ----------

/** Minimal persistence surface the CLI needs from the store module. */
export interface CliStore {
  saveCase(rec: CaseRecord): void;
  getCase(caseId: string): CaseRecord | undefined;
  getLedger(caseId: string): LedgerEntry[];
  appendLedger(
    caseId: string,
    epoch: number,
    type: LedgerEventType,
    payload: Record<string, unknown>,
  ): LedgerEntry;
  close(): void;
}

export interface ChainVerdict {
  ok: boolean;
  brokenAtSeq?: number;
}

export interface CliDeps {
  openStore(dbPath: string): CliStore | Promise<CliStore>;
  /** Returns the project CalleClient; MUST be a mock when live=false. */
  makeClient(opts: { live: boolean }): CalleClient | Promise<CalleClient>;
  verifyChain(entries: LedgerEntry[]): ChainVerdict | Promise<ChainVerdict>;
  /** Execute the next pending call for the case and return the updated record. */
  runStep(ctx: {
    rec: CaseRecord;
    store: CliStore;
    client: CalleClient;
    now: string;
  }): Promise<{ rec: CaseRecord; summary: string }>;
  now(): string;
}

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
}

/** Pick the first export matching one of `names`, or throw a pointed error. */
function pickExport<T>(
  mod: Record<string, unknown>,
  moduleName: string,
  names: string[],
): T {
  for (const name of names) {
    const candidate = mod[name];
    if (candidate !== undefined) return candidate as T;
  }
  throw new Error(
    `module "${moduleName}" does not export any of [${names.join(", ")}] — ` +
      "is that module implemented yet?",
  );
}

async function importModule(spec: string): Promise<Record<string, unknown>> {
  try {
    return (await import(spec)) as Record<string, unknown>;
  } catch (cause) {
    throw new Error(
      `cannot load module "${spec}" (not yet built?): ${String(cause)}`,
    );
  }
}

/**
 * Production wiring — static and typechecked.
 *
 * History note: this block originally resolved every collaborator by
 * convention with dynamic imports and candidate export names, so that a
 * partially built tree still ran. That design shipped a CLI that had never
 * once worked from a real terminal: `./store.js` did not exist, the calle
 * module exported none of the guessed factory names, and `runStep` was looked
 * up in the wrong module — while all tests passed with injected dependencies.
 * Static imports make every one of those a compile error instead.
 */
export function defaultDeps(): CliDeps {
  return {
    openStore: (dbPath) => realOpenStore(dbPath),
    makeClient: ({ live }) => {
      if (!live) return inlineMockClient();
      const apiKey = process.env["CALLE_API_KEY"];
      if (apiKey === undefined || apiKey.length === 0) {
        // cmdRun gates on the key's presence before requesting a live client;
        // this guard keeps the invariant even if a future caller forgets.
        throw new CliUsageError("--live requires CALLE_API_KEY in the environment");
      }
      return new RealCalleClient({ apiKey });
    },
    verifyChain: (entries) => verifyEntries(entries),
    runStep: async ({ rec, store, client, now }) => {
      // The concrete store exposes its ledger for transactional appends; a
      // test double without one simply runs the transition unledgered.
      const ledger =
        "ledger" in store
          ? { appendMany: (rows: Parameters<Ledger["appendMany"]>[0]) => (store as LedgerStore).ledger.appendMany(rows) }
          : undefined;
      const sink = ledger === undefined ? {} : { ledger };

      // Absorb clock-only transitions before counting the step. Every CLI
      // invocation is a fresh process that rehydrates from the ledger, and
      // `created -> consent_pending_a` is deliberately ledger-silent — so a
      // step that "spends" itself on that tick leaves nothing persisted, and
      // the next invocation repeats it forever. (Found by running the
      // documented commands end to end: eight `run --step` calls printed the
      // same state.) `--step` therefore means one unit of REAL work: ticks are
      // preamble, and the loop is bounded because a tick either advances the
      // record in memory or reports noop.
      let current = rec;
      while (!isTerminal(current.state) && pendingWork(current).kind === "tick") {
        const tick = await runnerRunStep({ rec: current, client, ...sink, now });
        if (tick.noop) break;
        current = tick.rec;
      }

      const step = await runnerRunStep({ rec: current, client, ...sink, now });
      return { rec: step.rec, summary: step.summary };
    },
    now: () => new Date().toISOString(),
  };
}

/**
 * Deterministic offline smoke persona for `run --step` without `--live`.
 *
 * This is deliberately a SMOKE PATH, not a negotiation simulation: consent is
 * granted, the first party opens at a flat $100 with no conditions, the other
 * party accepts whatever is relayed, and attestation echoes the code from the
 * task. That exercises every command (open/run/status/verify/memo) in a
 * couple of steps for ANY vertical without inventing vertical-specific
 * conditions the case never negotiated (demo realism lives in
 * `scripts/build-demo.ts`, which scripts personas per vertical).
 */
export function inlineMockClient(): CalleClient {
  let n = 0;
  const CODE_RE = /word for word: "(\d+)"/;
  return {
    async createAndWait(req) {
      n += 1;
      // Derive the id from the idempotency key (unique per case/round/callee/
      // purpose), not from a per-process counter: every CLI invocation is a
      // fresh process, so a counter restarts at 1 and mints the SAME id for
      // party A's and party B's attestation calls — which the verifier then
      // rightly rejects as one call counted twice. The distinct-call check
      // caught its own test double; the double was wrong, not the check.
      const callId = `mock_${req.idempotencyKey}`;
      void n;
      const respond = (structured: Record<string, unknown>, line: string): CallResult => ({
        callId,
        outcome: "completed",
        structured,
        confidence: { score: 0.9, label: "high" },
        evidence: [line],
        transcript: [{ offsetSeconds: 10, speaker: "user", text: line }],
      });
      switch (classifyCall(req)) {
        case "consent":
          return respond({ consent: "yes", concerns: "" }, "Yes, I agree to take these calls.");
        case "attestation": {
          const code = CODE_RE.exec(req.task)?.[1] ?? "";
          return respond({ phrase_spoken: code, agrees_to_terms: "yes" }, code);
        }
        case "offer": {
          const relayed = extractRelayedDollars(req.task);
          if (relayed !== null) {
            return respond(
              { offer_kind: "accept", amount_dollars: relayed, conditions: [], public_rationale: "", verbatim_quote: `I accept $${relayed}.` },
              `I accept $${relayed}.`,
            );
          }
          return respond(
            { offer_kind: "open", amount_dollars: 100, conditions: [], public_rationale: "Mock opening position.", verbatim_quote: "I can offer $100." },
            "I can offer $100.",
          );
        }
        default:
          return respond({}, "");
      }
    },
  };
}

// ---------- Command handlers ----------

function defaultPolicy(maxRounds: number): CasePolicy {
  return {
    maxRounds,
    coolingOffMinutes: 0,
    callWindow: { startHour: 9, endHour: 20, timezone: "America/New_York" },
    retryDelaysMinutes: [15, 60],
    ttlHours: 72,
  };
}

function buildParty(id: Party["id"], input: PartyInput): Party {
  return { id, label: input.label, phone: input.phone, private: {} };
}

async function cmdOpen(
  cmd: Extract<CliCommand, { cmd: "open" }>,
  deps: CliDeps,
  io: CliIo,
): Promise<number> {
  const store = await deps.openStore(cmd.db);
  try {
    const now = deps.now();
    // createCase validates; genesisEvent writes the canonical genesis payload —
    // the one rehydrate() consumes. The original hand-rolled genesis here
    // masked the phone numbers, which read as good hygiene and was actually a
    // bug: the ledger is the single source of truth, so a case rehydrated from
    // a masked genesis could never dial its parties. The local case db is
    // private; masking belongs to the EXPORT surfaces (memo, dashboard,
    // static replay), which all mask to last-4.
    const rec = createCase(
      {
        caseId: `cs_${randomUUID()}`,
        dispute: {
          vertical: cmd.vertical,
          summary: cmd.summary,
          amountCents: cmd.amountCents,
          currency: "USD",
        },
        parties: [buildParty("A", cmd.partyA), buildParty("B", cmd.partyB)],
        policy: defaultPolicy(cmd.maxRounds),
      },
      now,
    );
    store.saveCase(rec);
    const genesis = genesisEvent(rec);
    store.appendLedger(rec.caseId, rec.epoch, genesis.type, genesis.payload);
    io.out(rec.caseId);
    io.out(
      "case created — no calls will be placed until both parties record consent " +
        `(next: caucus run ${rec.caseId} --step)`,
    );
    return 0;
  } finally {
    store.close();
  }
}

/** Unicode sparkline of the offer curve, tagged with the offering party. */
export function sparkline(
  points: readonly { party: string; amountCents: number }[],
): string {
  if (points.length === 0) return "(no offers yet)";
  const blocks = "▁▂▃▄▅▆▇█";
  const amounts = points.map((p) => p.amountCents);
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  const span = max - min;
  return points
    .map((p) => {
      const level =
        span === 0
          ? 3
          : Math.min(7, Math.round(((p.amountCents - min) / span) * 7));
      return `${p.party}${blocks[level]}`;
    })
    .join(" ");
}

async function cmdStatus(
  cmd: Extract<CliCommand, { cmd: "status" }>,
  deps: CliDeps,
  io: CliIo,
): Promise<number> {
  const store = await deps.openStore(cmd.db);
  try {
    const rec = store.getCase(cmd.caseId);
    if (rec === undefined) {
      io.err(`no such case: ${cmd.caseId}`);
      return 1;
    }
    const [{ assess }, { formatUsd }] = await Promise.all([
      import("./engine.js"),
      import("./memo.js"),
    ]);
    const assessment = assess(rec);

    io.out(`case:    ${rec.caseId}`);
    io.out(`state:   ${rec.state}`);
    io.out(`dispute: ${rec.dispute.summary}`);
    io.out(`amount:  ${formatUsd(rec.dispute.amountCents)} ${rec.dispute.currency}`);
    io.out(`rounds:  ${rec.rounds.length}/${rec.policy.maxRounds}`);
    io.out("");
    if (rec.rounds.length > 0) {
      io.out("round  callee  kind         amount      outcome");
      for (const r of [...rec.rounds].sort((a, b) => a.n - b.n)) {
        const kind = r.offer?.kind ?? "—";
        const amount =
          r.offer?.amountCents === undefined ? "—" : formatUsd(r.offer.amountCents);
        io.out(
          `${String(r.n).padEnd(6)} ${r.callee.padEnd(7)} ${kind.padEnd(12)} ${amount.padEnd(11)} ${r.outcome}`,
        );
      }
      io.out("");
    }
    io.out(`curve:   ${sparkline(assessment.curve)}`);
    // NOTE: assessment.zopa is deliberately NOT printed — reservation-derived
    // numbers are system-side knowledge and never surface in operator output.
    if (assessment.impasse) {
      io.out(`impasse: ${assessment.impasseReason ?? "detected"}`);
    }
    if (assessment.nextSuggestionCents !== undefined) {
      io.out(`suggested midpoint: ${formatUsd(assessment.nextSuggestionCents)}`);
    }
    return 0;
  } finally {
    store.close();
  }
}

async function cmdRun(
  cmd: Extract<CliCommand, { cmd: "run" }>,
  deps: CliDeps,
  io: CliIo,
): Promise<number> {
  if (!cmd.step) {
    io.err("run currently requires --step (one call per invocation)");
    return 1;
  }
  if (cmd.live && cmd.mock) {
    io.err("--live and --mock are contradictory; pick one");
    return 1;
  }
  // SAFETY GATE: a real dial requires BOTH the explicit --live flag and a key.
  const live = cmd.live && typeof process.env["CALLE_API_KEY"] === "string";
  if (cmd.live && !live) {
    io.err("refusing --live: CALLE_API_KEY is not set");
    return 1;
  }

  const store = await deps.openStore(cmd.db);
  try {
    const rec = store.getCase(cmd.caseId);
    if (rec === undefined) {
      io.err(`no such case: ${cmd.caseId}`);
      return 1;
    }
    const client = await deps.makeClient({ live });
    io.out(live ? "mode: LIVE (real dialing enabled)" : "mode: mock (no real calls)");
    const result = await deps.runStep({
      rec,
      store,
      client,
      now: deps.now(),
    });
    store.saveCase(result.rec);
    io.out(result.summary);
    io.out(`state: ${result.rec.state} (epoch ${result.rec.epoch})`);
    return 0;
  } finally {
    store.close();
  }
}

/** Normalize an attestation phrase for tolerant comparison. */
export function normalizePhrase(phrase: string): string {
  return phrase
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function cmdVerify(
  cmd: Extract<CliCommand, { cmd: "verify" }>,
  deps: CliDeps,
  io: CliIo,
): Promise<number> {
  const store = await deps.openStore(cmd.db);
  try {
    const rec = store.getCase(cmd.caseId);
    if (rec === undefined) {
      io.err(`no such case: ${cmd.caseId}`);
      return 1;
    }
    let ok = true;

    const chain = await deps.verifyChain(store.getLedger(cmd.caseId));
    io.out(
      chain.ok
        ? "ledger chain: ok"
        : `ledger chain: BROKEN at seq ${chain.brokenAtSeq ?? "?"}`,
    );
    ok &&= chain.ok;

    if (rec.settlement !== undefined) {
      // The attest-domain verifier, not local string equality: digit codes
      // accept a bounded false start (a policy a live call forced), and a
      // second, subtly different comparison here is exactly how the two
      // verify surfaces would drift apart.
      for (const party of ["A", "B"] as const) {
        const att = rec.settlement.attestations[party];
        if (att === undefined) {
          io.out(`attestation ${party}: MISSING`);
          if (rec.state === "settled") ok = false;
          continue;
        }
        const matches = verifySpokenPhrase(
          rec.settlement.attestationPhrase,
          att.spokenPhrase,
        ).match;
        const pass = matches && att.verified;
        io.out(
          `attestation ${party}: ${pass ? "ok" : "FAIL"} (call ${att.callId})`,
        );
        ok &&= pass;
      }
      // Two attestations from one call would be one hearing counted twice.
      const attA = rec.settlement.attestations["A"];
      const attB = rec.settlement.attestations["B"];
      if (attA !== undefined && attB !== undefined && attA.callId === attB.callId) {
        io.out(`attestations: FAIL — both cite the same call (${attA.callId})`);
        ok = false;
      }
    } else if (rec.state === "settled") {
      io.out("attestations: MISSING settlement on settled case");
      ok = false;
    }

    io.out(ok ? "verify: PASS" : "verify: FAIL");
    return ok ? 0 : 1;
  } finally {
    store.close();
  }
}

async function cmdMemo(
  cmd: Extract<CliCommand, { cmd: "memo" }>,
  deps: CliDeps,
  io: CliIo,
): Promise<number> {
  const store = await deps.openStore(cmd.db);
  try {
    const rec = store.getCase(cmd.caseId);
    if (rec === undefined) {
      io.err(`no such case: ${cmd.caseId}`);
      return 1;
    }
    const { renderMemo, writeMemoJson } = await import("./memo.js");
    const ledger = store.getLedger(cmd.caseId);
    const now = deps.now();
    writeFileSync(cmd.out, renderMemo(rec, ledger, now), "utf8");
    io.out(`wrote ${cmd.out}`);
    if (cmd.json !== undefined) {
      writeFileSync(
        cmd.json,
        `${JSON.stringify(writeMemoJson(rec, ledger, now), null, 2)}\n`,
        "utf8",
      );
      io.out(`wrote ${cmd.json}`);
    }
    return 0;
  } finally {
    store.close();
  }
}

// ---------- Entry point ----------

const consoleIo: CliIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

/** Run one CLI invocation. Returns the process exit code. */
export async function runCli(
  argv: readonly string[],
  io: CliIo = consoleIo,
  deps: CliDeps = defaultDeps(),
): Promise<number> {
  let command: CliCommand;
  try {
    command = parseCliArgs(argv);
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    io.err(USAGE);
    return 2;
  }

  try {
    switch (command.cmd) {
      case "help":
        io.out(USAGE);
        return 0;
      case "open":
        return await cmdOpen(command, deps, io);
      case "status":
        return await cmdStatus(command, deps, io);
      case "run":
        return await cmdRun(command, deps, io);
      case "verify":
        return await cmdVerify(command, deps, io);
      case "memo":
        return await cmdMemo(command, deps, io);
    }
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

const isDirectInvocation =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectInvocation) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
