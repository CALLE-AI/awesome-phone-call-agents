/**
 * Caucus runner — the orchestrator that actually moves a case forward.
 *
 * One `runStep` call performs exactly one unit of progress:
 *
 *   1. read the case state and decide which call (if any) is owed next;
 *   2. render that call through the taint-checking renderer (`src/renderer.ts`),
 *      which throws rather than emit a task carrying the other party's private data;
 *   3. place it via the injected `CalleClient` (mock or real — the CLI decides,
 *      and only dials for real behind an explicit `--live` flag plus an API key);
 *   4. fold the terminal `CallResult` into the state machine (`src/state.ts`);
 *   5. append the resulting events to the hash-chained ledger (`src/ledger.ts`).
 *
 * Deliberately one-step-at-a-time: every real call costs money and rings a human,
 * so an operator (or a test) advances the case explicitly rather than handing a
 * loop the authority to dial a stranger N times. `runCase` exists for tests and
 * demos, and takes an explicit `maxSteps` bound for the same reason.
 *
 * Nothing here is CLI-specific: the dashboard and the MCP wrapper drive a case
 * through this same entry point.
 */
import type {
  CalleClient,
  CallResult,
  CaseEvent,
  CaseRecord,
  LedgerEntry,
  PartyId,
  RenderedCall,
} from "./types.js";
import {
  calleeForRound,
  isTerminal,
  makeTransition,
  type LedgerEventDraft,
  type Transition,
} from "./state.js";
import { renderAttestationCall, renderConsentCall, renderShuttleCall } from "./renderer.js";
import { assess } from "./engine.js";
import { codeForTerms, termsDigest, verifySpokenPhrase } from "./attest.js";

/** What the next unit of work is, before anything is dialed. */
export type PendingWork =
  | { kind: "call"; purpose: "consent" | "shuttle" | "attestation"; callee: PartyId }
  /** The case needs a clock nudge (open -> consent, or TTL expiry) — no dialing. */
  | { kind: "tick" }
  | { kind: "none"; reason: string };

/**
 * Minimal ledger surface the runner needs; `openLedger()` satisfies it.
 *
 * Deliberately `appendMany`, not `append`: a single transition can emit several
 * drafts (an accept emits `offer_recorded` AND `settlement_proposed`), and
 * writing them one row at a time leaves a window where a crash persists the
 * first and loses the second. The state machine can heal that tear on replay,
 * but the cheaper fix is to make it unreachable — `appendMany` is a sqlite
 * transaction, so a transition's drafts land all-or-nothing.
 */
export interface LedgerSink {
  appendMany(
    entries: {
      caseId: string;
      epoch: number;
      type: LedgerEventDraft["type"];
      payload: Record<string, unknown>;
      at: string;
    }[],
  ): LedgerEntry[];
}

export interface RunStepContext {
  rec: CaseRecord;
  client: CalleClient;
  /** Where ledger events land. Omit only in unit tests that assert drafts directly. */
  ledger?: LedgerSink;
  now: string;
}

export interface RunStepResult {
  rec: CaseRecord;
  /** Human-readable line for CLI output. */
  summary: string;
  /** The call placed this step, when one was. */
  call?: RenderedCall;
  result?: CallResult;
  /** Ledger entries appended this step. */
  appended: LedgerEntry[];
  /** True when this step changed nothing (terminal state, or a no-op result). */
  noop: boolean;
}

/**
 * Settlement identity: the digest binds the exact terms, and the spoken
 * confirmation code is derived from that digest, so two parties who both read
 * the code back have provably attested to the same terms on two independent
 * transcripts.
 *
 * The code is DIGITS, not words. An earlier design used a three-word phrase from
 * a wordlist with no edit-distance-1 pairs; that property was real but was the
 * wrong metric, and live calls disproved it — "topaz chowder cyclone" came back
 * as "Joe Pads, chowder, 2nd 1." Words spoken in isolation give a speech decoder
 * no linguistic context. Digits are the token class voice channels transcribe
 * most reliably, which is why bank and 2FA read-back codes use them. The
 * field is still named `attestationPhrase` (a frozen contract in types.ts); only
 * its encoding changed.
 */
const computeSettlement = (terms: { amountCents: number; conditions: readonly string[] }) => ({
  termsDigest: termsDigest(terms),
  attestationPhrase: codeForTerms(terms),
});

const transition: Transition = makeTransition({
  computeSettlement,
  // The attest-domain comparison, not plain equality: on a real call a callee
  // false-started the code ("935… 935006") and exact matching wrongly rejected
  // a read-back any human reviewer would accept.
  verifySpoken: (expected, spoken) => verifySpokenPhrase(expected, spoken).match,
  assessImpasse: (rec) => {
    const a = assess(rec);
    return a.impasse
      ? { impasse: true, ...(a.impasseReason === undefined ? {} : { impasseReason: a.impasseReason }) }
      : { impasse: false };
  },
});

/** Decide what the case owes next. Pure: inspects state only, dials nothing. */
export function pendingWork(rec: CaseRecord): PendingWork {
  if (isTerminal(rec.state)) {
    return { kind: "none", reason: `case is ${rec.state}` };
  }
  switch (rec.state) {
    case "created":
      return { kind: "tick" };
    case "consent_pending_a":
      return { kind: "call", purpose: "consent", callee: "A" };
    case "consent_pending_b":
      return { kind: "call", purpose: "consent", callee: "B" };
    case "rounds_active":
      return {
        kind: "call",
        purpose: "shuttle",
        callee: calleeForRound(rec.rounds.length + 1),
      };
    case "attestation_pending_a":
      return { kind: "call", purpose: "attestation", callee: "A" };
    case "attestation_pending_b":
      return { kind: "call", purpose: "attestation", callee: "B" };
    default:
      return { kind: "none", reason: `no work defined for state ${rec.state}` };
  }
}

function renderFor(rec: CaseRecord, work: Extract<PendingWork, { kind: "call" }>): RenderedCall {
  switch (work.purpose) {
    case "consent":
      return renderConsentCall(rec, work.callee);
    case "shuttle":
      return renderShuttleCall(rec, work.callee, assess(rec));
    case "attestation":
      return renderAttestationCall(rec, work.callee);
  }
}

function eventFor(
  rec: CaseRecord,
  work: Extract<PendingWork, { kind: "call" }>,
  result: CallResult,
): CaseEvent {
  switch (work.purpose) {
    case "consent":
      return { kind: "consent_result", party: work.callee, result };
    case "shuttle":
      return { kind: "round_result", round: rec.rounds.length + 1, result };
    case "attestation":
      return { kind: "attestation_result", party: work.callee, result };
  }
}

function describe(work: PendingWork, result?: CallResult): string {
  if (work.kind !== "call") return work.kind === "tick" ? "advanced clock" : "no work";
  const outcome = result?.outcome ?? "unknown";
  return `${work.purpose} call to party ${work.callee}: ${outcome}`;
}

/** Advance the case by exactly one step. */
export async function runStep(ctx: RunStepContext): Promise<RunStepResult> {
  const { rec, client, ledger, now } = ctx;
  const work = pendingWork(rec);

  if (work.kind === "none") {
    return { rec, summary: work.reason, appended: [], noop: true };
  }

  const { next, drafts, result, call } = await (async () => {
    if (work.kind === "tick") {
      const t = transition(rec, { kind: "tick", now }, now);
      return { next: t.next, drafts: t.ledgerEvents, result: undefined, call: undefined };
    }
    // Render first: a taint violation must abort BEFORE a human's phone rings.
    const rendered = renderFor(rec, work);
    const callResult = await client.createAndWait(rendered);
    const t = transition(rec, eventFor(rec, work, callResult), now);
    return { next: t.next, drafts: t.ledgerEvents, result: callResult, call: rendered };
  })();

  // One transaction per transition: either every draft for this step is durable
  // or none of it is (see LedgerSink).
  const appended =
    ledger && drafts.length > 0
      ? ledger.appendMany(
          drafts.map((d) => ({
            caseId: next.caseId,
            epoch: next.epoch,
            type: d.type,
            payload: d.payload,
            at: now,
          })),
        )
      : [];

  return {
    rec: next,
    summary: describe(work, result),
    ...(call === undefined ? {} : { call }),
    ...(result === undefined ? {} : { result }),
    appended,
    noop: next.epoch === rec.epoch,
  };
}

export interface RunCaseOptions {
  rec: CaseRecord;
  client: CalleClient;
  ledger?: LedgerSink;
  /** Hard bound on steps — never let a loop dial unbounded. */
  maxSteps: number;
  /** Clock; defaults to real time. Tests inject a deterministic one. */
  clock?: () => string;
  /** Called after every step, for progress output. */
  onStep?: (step: RunStepResult, index: number) => void;
}

export interface RunCaseResult {
  rec: CaseRecord;
  steps: RunStepResult[];
  /** True when the case reached a terminal state within maxSteps. */
  finished: boolean;
}

/**
 * Drive a case to a terminal state (or `maxSteps`). Intended for tests, demos,
 * and mock runs; live operation goes one deliberate `runStep` at a time.
 */
export async function runCase(opts: RunCaseOptions): Promise<RunCaseResult> {
  const clock = opts.clock ?? (() => new Date().toISOString());
  const steps: RunStepResult[] = [];
  let rec = opts.rec;

  for (let i = 0; i < opts.maxSteps; i += 1) {
    if (isTerminal(rec.state)) break;
    const step = await runStep({
      rec,
      client: opts.client,
      ...(opts.ledger === undefined ? {} : { ledger: opts.ledger }),
      now: clock(),
    });
    steps.push(step);
    opts.onStep?.(step, i);
    // A step that changed nothing would spin forever: stop and let the caller
    // decide (a no-answer needs a retry delay, not an immediate redial).
    if (step.noop) break;
    rec = step.rec;
  }

  return { rec, steps, finished: isTerminal(rec.state) };
}
