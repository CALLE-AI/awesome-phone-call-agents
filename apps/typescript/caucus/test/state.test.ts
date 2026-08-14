/**
 * Case state machine: transitions, idempotency, ledger drafts, and replay.
 *
 * The state module is pure, so these tests drive it exactly the way the
 * orchestrator does — feed a `CaseEvent`, stamp the returned ledger drafts with
 * the *next* record's epoch, repeat — and then prove that `rehydrate` over the
 * resulting entries reconstructs the same record, from every prefix of the
 * event stream (crash resume).
 *
 * All phone numbers are fictional/masked (+1555…); nothing here dials anything.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  calleeForRound,
  createCase,
  genesisEvent,
  isTerminal,
  makeTransition,
  normalizePhrase,
  rehydrate,
  type LedgerEventDraft,
  type SettlementTerms,
  type Transition,
} from "../src/state.js";
import { GENESIS_HASH, canonicalize, computeEntryHash, openLedger } from "../src/ledger.js";
import type {
  CallOutcome,
  CallResult,
  CaseEvent,
  CasePolicy,
  CaseRecord,
  CaseState,
  Dispute,
  LedgerEntry,
  LedgerEventType,
  Party,
  PartyId,
  Settlement,
} from "../src/types.js";

// ---------- Fixtures ----------

const CASE_ID = "cs_state_0001";
const PHONE_A = "+15550000001";
const PHONE_B = "+15550000002";
const T0 = "2026-07-30T12:00:00.000Z";
const T0_MS = Date.parse(T0);
const AMOUNT_CENTS = 120_000;

/** Timestamp `minutes` after case creation (fractions allowed for resume ticks). */
function at(minutes: number): string {
  return new Date(T0_MS + minutes * 60_000).toISOString();
}

function makeParties(): [Party, Party] {
  return [
    {
      id: "A",
      label: "Tenant Alex",
      phone: PHONE_A,
      private: { reservationCents: 70_000, notes: "carpet was already stained at move-in" },
    },
    { id: "B", label: "Landlord Sam", phone: PHONE_B, private: { reservationCents: 90_000 } },
  ];
}

function makeDispute(amountCents: number = AMOUNT_CENTS): Dispute {
  return {
    vertical: "security_deposit",
    summary: "How much of a $1,200 security deposit is returned.",
    amountCents,
    currency: "USD",
  };
}

function makePolicy(overrides: Partial<CasePolicy> = {}): CasePolicy {
  return {
    maxRounds: 8,
    coolingOffMinutes: 0,
    callWindow: { startHour: 9, endHour: 20, timezone: "America/New_York" },
    retryDelaysMinutes: [],
    ttlHours: 72,
    ...overrides,
  };
}

function newCase(opts: { policy?: Partial<CasePolicy>; amountCents?: number } = {}): CaseRecord {
  return createCase(
    {
      caseId: CASE_ID,
      dispute: makeDispute(opts.amountCents),
      parties: makeParties(),
      policy: makePolicy(opts.policy),
    },
    T0,
  );
}

// ---------- Injected settlement digest (deterministic stand-in for src/attest) ----------

const PHRASE_WORDS = ["anchor", "basalt", "cobalt", "dune", "ember", "fjord", "granite", "harbor"];

function stubSettlement(terms: SettlementTerms): {
  termsDigest: string;
  attestationPhrase: string;
} {
  const termsDigest = createHash("sha256")
    .update(canonicalize({ amountCents: terms.amountCents, conditions: [...terms.conditions].sort() }), "utf8")
    .digest("hex");
  const attestationPhrase = [0, 1, 2]
    .map((i) => {
      const byte = Number.parseInt(termsDigest.slice(i * 2, i * 2 + 2), 16);
      return PHRASE_WORDS[byte % PHRASE_WORDS.length] as string;
    })
    .join(" ");
  return { termsDigest, attestationPhrase };
}

const transition: Transition = makeTransition({ computeSettlement: stubSettlement });

// ---------- Call results & events ----------

function callResult(
  callId: string,
  structured: Record<string, unknown> | null,
  overrides: Partial<CallResult> = {},
): CallResult {
  return {
    callId,
    outcome: "completed",
    structured,
    evidence: [],
    transcript: [],
    ...overrides,
  };
}

function consentEv(
  party: PartyId,
  consent: string,
  overrides: Partial<CallResult> = {},
): CaseEvent {
  return {
    kind: "consent_result",
    party,
    result: callResult(`call_consent_${party}`, { consent }, overrides),
  };
}

interface OfferSpec {
  kind: string;
  dollars?: number | null;
  conditions?: string[];
  rationale?: string;
  callId?: string;
  outcome?: CallOutcome;
  structured?: Record<string, unknown> | null;
  evidence?: string[];
}

function offerEv(round: number, spec: OfferSpec): CaseEvent {
  const structured: Record<string, unknown> = { offer_kind: spec.kind };
  if (spec.dollars !== undefined) structured.amount_dollars = spec.dollars;
  if (spec.conditions !== undefined) structured.conditions = spec.conditions;
  if (spec.rationale !== undefined) structured.public_rationale = spec.rationale;
  const overrides: Partial<CallResult> = {};
  if (spec.outcome !== undefined) overrides.outcome = spec.outcome;
  if (spec.evidence !== undefined) overrides.evidence = spec.evidence;
  return {
    kind: "round_result",
    round,
    result: callResult(
      spec.callId ?? `call_r${round}`,
      spec.structured !== undefined ? spec.structured : structured,
      overrides,
    ),
  };
}

function attestEv(party: PartyId, phrase: string, callId?: string): CaseEvent {
  return {
    kind: "attestation_result",
    party,
    result: callResult(callId ?? `call_attest_${party}`, { phrase_spoken: phrase }),
  };
}

function draftTypes(drafts: readonly LedgerEventDraft[]): LedgerEventType[] {
  return drafts.map((d) => d.type);
}

// ---------- Ledger driving (mirrors what the orchestrator persists) ----------

interface Run {
  rec: CaseRecord;
  entries: LedgerEntry[];
}

function appendDrafts(
  entries: LedgerEntry[],
  caseId: string,
  epoch: number,
  drafts: readonly LedgerEventDraft[],
  when: string,
): void {
  for (const draft of drafts) {
    const seq = entries.length + 1;
    const prevHash = entries[entries.length - 1]?.hash ?? GENESIS_HASH;
    const unhashed = {
      seq,
      caseId,
      epoch,
      type: draft.type,
      // Round-trip through the canonical form, exactly as sqlite storage does.
      payload: JSON.parse(canonicalize(draft.payload)) as Record<string, unknown>,
      at: when,
      prevHash,
    };
    entries.push({ ...unhashed, hash: computeEntryHash(unhashed) });
  }
}

function startRun(rec: CaseRecord): Run {
  const entries: LedgerEntry[] = [];
  appendDrafts(entries, rec.caseId, rec.epoch, [genesisEvent(rec)], rec.createdAt);
  return { rec, entries };
}

/**
 * Applies `events` starting at absolute index `firstIndex`; event i always
 * happens at `at(i + 1)` so an interrupted run and an uninterrupted one use
 * identical clocks.
 */
function applyEvents(start: Run, events: readonly CaseEvent[], firstIndex: number): Run {
  let rec = start.rec;
  const entries = [...start.entries];
  events.forEach((ev, i) => {
    const when = at(firstIndex + i + 1);
    const event: CaseEvent = ev.kind === "tick" ? { ...ev, now: when } : ev;
    const res = transition(rec, event, when);
    appendDrafts(entries, rec.caseId, res.next.epoch, res.ledgerEvents, when);
    rec = res.next;
  });
  return { rec, entries };
}

/** The fields a rehydrated record must reproduce exactly. */
function project(rec: CaseRecord): Record<string, unknown> {
  return {
    caseId: rec.caseId,
    state: rec.state,
    epoch: rec.epoch,
    rounds: rec.rounds,
    settlement: rec.settlement,
    dispute: rec.dispute,
    parties: rec.parties,
    policy: rec.policy,
    createdAt: rec.createdAt,
  };
}

/**
 * Same as {@link project} minus every wall-clock field — used when comparing
 * two runs whose events land at different times (e.g. duplicate delivery).
 */
function projectTimeless(rec: CaseRecord): Record<string, unknown> {
  const s = rec.settlement;
  return {
    state: rec.state,
    epoch: rec.epoch,
    rounds: rec.rounds.map((r) => ({
      n: r.n,
      callee: r.callee,
      callId: r.callId,
      offer: r.offer,
      outcome: r.outcome,
    })),
    settlement:
      s === undefined
        ? undefined
        : {
            amountCents: s.amountCents,
            conditions: s.conditions,
            termsDigest: s.termsDigest,
            attestationPhrase: s.attestationPhrase,
            attestations: Object.fromEntries(
              Object.entries(s.attestations).map(([party, a]) => [
                party,
                { callId: a?.callId, spokenPhrase: a?.spokenPhrase, verified: a?.verified },
              ]),
            ),
          },
  };
}

/** Crash resume = rehydrate from the ledger, then re-tick (as the orchestrator does). */
function resumeFrom(entries: readonly LedgerEntry[], k: number): CaseRecord {
  const when = at(k + 0.5);
  return transition(rehydrate(CASE_ID, entries), { kind: "tick", now: when }, when).next;
}

function assertCrashResumeEquivalence(base: CaseRecord, events: readonly CaseEvent[]): void {
  const uninterrupted = applyEvents(startRun(base), events, 0);
  for (let k = 0; k <= events.length; k += 1) {
    const prefix = applyEvents(startRun(base), events.slice(0, k), 0);
    const resumed = resumeFrom(prefix.entries, k);
    const finished = applyEvents({ rec: resumed, entries: [] }, events.slice(k), k);
    expect(project(finished.rec)).toEqual(project(uninterrupted.rec));
  }
}

/** The canonical settled run used by several tests. */
const SETTLE_CONDITIONS = ["tenant returns the garage remote"];
const SETTLED_AMOUNT_CENTS = 60_000;

function settledEvents(): CaseEvent[] {
  const phrase = stubSettlement({
    amountCents: SETTLED_AMOUNT_CENTS,
    conditions: SETTLE_CONDITIONS,
  }).attestationPhrase;
  return [
    { kind: "tick", now: T0 },
    consentEv("A", "yes"),
    consentEv("B", "yes"),
    offerEv(1, { kind: "open", dollars: 700, rationale: "deposit was $1,200" }),
    offerEv(2, { kind: "counter", dollars: 400 }),
    offerEv(3, { kind: "counter", dollars: 600 }),
    offerEv(4, { kind: "accept", dollars: 600, conditions: SETTLE_CONDITIONS }),
    attestEv("A", phrase),
    attestEv("B", phrase),
  ];
}

// ---------- createCase ----------

describe("createCase", () => {
  it("starts in state created at epoch 0 with no rounds and no settlement", () => {
    const rec = newCase();
    expect(rec.state).toBe("created");
    expect(rec.epoch).toBe(0);
    expect(rec.rounds).toEqual([]);
    expect(rec.settlement).toBeUndefined();
    expect(rec.createdAt).toBe(T0);
    expect(rec.updatedAt).toBe(T0);
    expect(rec.parties.map((p) => p.phone)).toEqual([PHONE_A, PHONE_B]);
  });

  it("normalizes party order to [A, B] regardless of input order", () => {
    const [a, b] = makeParties();
    const rec = createCase(
      { caseId: CASE_ID, dispute: makeDispute(), parties: [b, a], policy: makePolicy() },
      T0,
    );
    expect(rec.parties.map((p) => p.id)).toEqual(["A", "B"]);
  });

  it("rejects structurally invalid inputs", () => {
    const ok = { caseId: CASE_ID, dispute: makeDispute(), parties: makeParties(), policy: makePolicy() };
    expect(() => createCase({ ...ok, caseId: "" }, T0)).toThrow(/caseId/);
    expect(() => createCase({ ...ok, dispute: makeDispute(0) }, T0)).toThrow(/amountCents/);
    expect(() => createCase({ ...ok, dispute: makeDispute(-1) }, T0)).toThrow(/amountCents/);
    expect(() => createCase({ ...ok, dispute: makeDispute(10.5) }, T0)).toThrow(/amountCents/);
    const [a] = makeParties();
    expect(() => createCase({ ...ok, parties: [a, a] }, T0)).toThrow(/exactly one/);
    expect(() => createCase({ ...ok, policy: makePolicy({ maxRounds: 0 }) }, T0)).toThrow(/maxRounds/);
    expect(() => createCase({ ...ok, policy: makePolicy({ maxRounds: 1.5 }) }, T0)).toThrow(/maxRounds/);
    expect(() => createCase({ ...ok, policy: makePolicy({ ttlHours: 0 }) }, T0)).toThrow(/ttlHours/);
    expect(() => createCase(ok, "not-a-timestamp")).toThrow(/invalid timestamp/);
  });
});

// ---------- Pure helpers ----------

describe("pure helpers", () => {
  it("calleeForRound alternates: odd rounds call A, even rounds call B", () => {
    expect([1, 2, 3, 4, 5, 6].map(calleeForRound)).toEqual(["A", "B", "A", "B", "A", "B"]);
  });

  it("normalizePhrase ignores case, punctuation, spacing and diacritics", () => {
    expect(normalizePhrase("Anchor, Basalt!  Cobalt.")).toBe("anchor basalt cobalt");
    expect(normalizePhrase("  ANCHOR   basalt cobalt ")).toBe("anchor basalt cobalt");
    expect(normalizePhrase("café")).toBe("cafe");
    expect(normalizePhrase("anchor basalt")).not.toBe(normalizePhrase("anchor cobalt"));
  });

  it("isTerminal covers exactly the five end states", () => {
    const terminal: CaseState[] = ["settled", "impasse", "declined_consent", "expired", "cancelled"];
    const active: CaseState[] = [
      "created",
      "consent_pending_a",
      "consent_pending_b",
      "rounds_active",
      "attestation_pending_a",
      "attestation_pending_b",
    ];
    for (const s of terminal) expect(isTerminal(s)).toBe(true);
    for (const s of active) expect(isTerminal(s)).toBe(false);
  });
});

// ---------- Happy path ----------

describe("happy path: created -> settled", () => {
  it("walks consent, four shuttle rounds, dual attestation, and settles", () => {
    const expectedSettlement = stubSettlement({
      amountCents: SETTLED_AMOUNT_CENTS,
      conditions: SETTLE_CONDITIONS,
    });
    const events = settledEvents();
    const expectedStates: CaseState[] = [
      "consent_pending_a",
      "consent_pending_b",
      "rounds_active",
      "rounds_active",
      "rounds_active",
      "rounds_active",
      "attestation_pending_a",
      "attestation_pending_b",
      "settled",
    ];
    const expectedDrafts: LedgerEventType[][] = [
      [],
      ["consent_recorded"],
      ["consent_recorded"],
      ["offer_recorded"],
      ["offer_recorded"],
      ["offer_recorded"],
      ["offer_recorded", "settlement_proposed"],
      ["attestation_recorded"],
      ["attestation_recorded", "case_settled"],
    ];

    let rec = newCase();
    const epochs = [rec.epoch];
    events.forEach((ev, i) => {
      const when = at(i + 1);
      const event: CaseEvent = ev.kind === "tick" ? { ...ev, now: when } : ev;
      const res = transition(rec, event, when);
      expect(res.next.state).toBe(expectedStates[i]);
      expect(draftTypes(res.ledgerEvents)).toEqual(expectedDrafts[i]);
      expect(res.next.epoch).toBe(rec.epoch + 1); // every step here is accepted
      expect(res.next.updatedAt).toBe(when);
      epochs.push(res.next.epoch);
      rec = res.next;
    });

    // 9 events, every one accepted: epoch rises by exactly one each time.
    expect(epochs).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(rec.state).toBe("settled");
    expect(rec.rounds.map((r) => r.n)).toEqual([1, 2, 3, 4]);
    expect(rec.rounds.map((r) => r.callee)).toEqual(["A", "B", "A", "B"]);
    expect(rec.rounds.map((r) => r.offer?.kind)).toEqual(["open", "counter", "counter", "accept"]);
    expect(rec.rounds.map((r) => r.offer?.amountCents)).toEqual([70_000, 40_000, 60_000, 60_000]);
    expect(rec.rounds.map((r) => r.outcome)).toEqual(["completed", "completed", "completed", "completed"]);
    expect(rec.rounds[0]?.offer?.publicRationale).toBe("deposit was $1,200");

    const settlement = rec.settlement as Settlement;
    expect(settlement.amountCents).toBe(SETTLED_AMOUNT_CENTS);
    expect(settlement.conditions).toEqual(SETTLE_CONDITIONS);
    expect(settlement.termsDigest).toBe(expectedSettlement.termsDigest);
    expect(settlement.attestationPhrase).toBe(expectedSettlement.attestationPhrase);
    expect(settlement.attestations.A?.verified).toBe(true);
    expect(settlement.attestations.B?.verified).toBe(true);
    expect(settlement.attestations.A?.callId).toBe("call_attest_A");
    expect(settlement.attestations.B?.callId).toBe("call_attest_B");
    expect(settlement.attestations.A?.at).toBe(at(8));
    expect(settlement.attestations.B?.at).toBe(at(9));
  });

  it("carries the exact settlement identifiers into the ledger payloads", () => {
    const { entries } = applyEvents(startRun(newCase()), settledEvents(), 0);
    const byType = new Map(entries.map((e) => [e.type, e]));
    const expected = stubSettlement({
      amountCents: SETTLED_AMOUNT_CENTS,
      conditions: SETTLE_CONDITIONS,
    });
    expect(byType.get("settlement_proposed")?.payload).toEqual({
      settlement: {
        amountCents: SETTLED_AMOUNT_CENTS,
        attestationPhrase: expected.attestationPhrase,
        conditions: SETTLE_CONDITIONS,
        termsDigest: expected.termsDigest,
      },
    });
    expect(byType.get("case_settled")?.payload).toEqual({
      amountCents: SETTLED_AMOUNT_CENTS,
      termsDigest: expected.termsDigest,
    });
    expect(entries.map((e) => e.type)).toEqual([
      "case_created",
      "consent_recorded",
      "consent_recorded",
      "offer_recorded",
      "offer_recorded",
      "offer_recorded",
      "offer_recorded",
      "settlement_proposed",
      "attestation_recorded",
      "attestation_recorded",
      "case_settled",
    ]);
  });
});

// ---------- Consent ----------

describe("consent", () => {
  const pendingA = (): CaseRecord => ({ ...newCase(), state: "consent_pending_a", epoch: 1 });

  it("records A's yes and moves to consent_pending_b", () => {
    const res = transition(pendingA(), consentEv("A", "yes"), at(1));
    expect(res.next.state).toBe("consent_pending_b");
    expect(res.next.epoch).toBe(2);
    expect(res.ledgerEvents).toEqual([
      {
        type: "consent_recorded",
        payload: { party: "A", callId: "call_consent_A", consent: "yes" },
      },
    ]);
  });

  it("records B's yes and opens the rounds", () => {
    const rec: CaseRecord = { ...newCase(), state: "consent_pending_b", epoch: 2 };
    const res = transition(rec, consentEv("B", "yes"), at(2));
    expect(res.next.state).toBe("rounds_active");
    expect(res.next.epoch).toBe(3);
    expect(draftTypes(res.ledgerEvents)).toEqual(["consent_recorded"]);
  });

  it("a refusal terminates the case as declined_consent", () => {
    const res = transition(pendingA(), consentEv("A", "no"), at(1));
    expect(res.next.state).toBe("declined_consent");
    expect(res.next.epoch).toBe(2);
    expect(res.ledgerEvents).toEqual([
      { type: "consent_declined", payload: { party: "A", callId: "call_consent_A" } },
    ]);
    expect(isTerminal(res.next.state)).toBe(true);
  });

  it('an "unknown" consent is a no-op that leaves the record untouched', () => {
    const rec = pendingA();
    const res = transition(rec, consentEv("A", "unknown"), at(1));
    expect(res.next).toBe(rec); // same instance
    expect(res.next.state).toBe("consent_pending_a");
    expect(res.next.epoch).toBe(1);
    expect(res.ledgerEvents).toEqual([]);
  });

  it("a no_answer / failed call is a no-op (the retry ladder is the caller's job)", () => {
    const rec = pendingA();
    for (const outcome of ["no_answer", "declined", "timed_out", "failed", "pending"] as const) {
      const res = transition(rec, consentEv("A", "yes", { outcome }), at(1));
      expect(res.next).toBe(rec);
      expect(res.ledgerEvents).toEqual([]);
    }
  });

  it("a missing or unparseable structured result is a no-op", () => {
    const rec = pendingA();
    const noStructured: CaseEvent = {
      kind: "consent_result",
      party: "A",
      result: callResult("call_x", null),
    };
    const garbage: CaseEvent = {
      kind: "consent_result",
      party: "A",
      result: callResult("call_x", { consent: "maybe" }),
    };
    expect(transition(rec, noStructured, at(1)).next).toBe(rec);
    expect(transition(rec, garbage, at(1)).next).toBe(rec);
    expect(transition(rec, garbage, at(1)).ledgerEvents).toEqual([]);
  });

  it("consent from the party we are not waiting on is a no-op", () => {
    const rec = pendingA();
    const res = transition(rec, consentEv("B", "yes"), at(1));
    expect(res.next).toBe(rec);
    expect(res.ledgerEvents).toEqual([]);
  });

  it("consent outside the consent states is a no-op", () => {
    const rec: CaseRecord = { ...newCase(), state: "rounds_active", epoch: 3 };
    expect(transition(rec, consentEv("A", "yes"), at(3)).next).toBe(rec);
  });

  it("IDEMPOTENT: a re-delivered consent webhook changes nothing", () => {
    const rec = pendingA();
    const ev = consentEv("A", "yes");
    const first = transition(rec, ev, at(1));
    const replay = transition(first.next, ev, at(1));
    expect(replay.next).toBe(first.next); // same instance
    expect(replay.next.epoch).toBe(first.next.epoch);
    expect(replay.next.state).toBe("consent_pending_b");
    expect(replay.ledgerEvents).toEqual([]);
  });
});

// ---------- Rounds & offer validation ----------

describe("rounds", () => {
  const active = (overrides: Partial<CaseRecord> = {}): CaseRecord => ({
    ...newCase(),
    state: "rounds_active",
    epoch: 3,
    ...overrides,
  });

  it("records an offer, keeps the case active, and drafts offer_recorded", () => {
    const res = transition(
      active(),
      offerEv(1, { kind: "open", dollars: 700, conditions: ["keys returned"], evidence: ["I want $700 back"] }),
      at(4),
    );
    expect(res.next.state).toBe("rounds_active");
    expect(res.next.epoch).toBe(4);
    expect(draftTypes(res.ledgerEvents)).toEqual(["offer_recorded"]);
    expect(res.next.rounds).toEqual([
      {
        n: 1,
        callee: "A",
        callId: "call_r1",
        offer: {
          kind: "open",
          amountCents: 70_000,
          conditions: ["keys returned"],
          evidence: ["I want $700 back"],
        },
        outcome: "completed",
        startedAt: at(4),
        completedAt: at(4),
      },
    ]);
  });

  it("accepts whole-cent amounts that are not whole dollars", () => {
    const res = transition(active(), offerEv(1, { kind: "open", dollars: 700.25 }), at(4));
    expect(res.next.rounds[0]?.offer?.amountCents).toBe(70_025);
  });

  it("accepts the exact bounds 0 and dispute.amountCents", () => {
    const zero = transition(active(), offerEv(1, { kind: "open", dollars: 0 }), at(4));
    expect(zero.next.rounds[0]?.offer?.amountCents).toBe(0);
    const max = transition(active(), offerEv(1, { kind: "open", dollars: AMOUNT_CENTS / 100 }), at(4));
    expect(max.next.rounds[0]?.offer?.amountCents).toBe(AMOUNT_CENTS);
  });

  it("records reject / no_response rounds without an amount", () => {
    for (const kind of ["reject", "no_response"] as const) {
      const res = transition(active(), offerEv(1, { kind }), at(4));
      expect(res.next.state).toBe("rounds_active");
      expect(res.next.rounds[0]?.offer).toEqual({ kind, conditions: [], evidence: [] });
    }
  });

  it.each([
    ["negative amount", { kind: "counter", dollars: -50 }, "amount_out_of_bounds"],
    ["amount above the disputed total", { kind: "counter", dollars: 1201 }, "amount_out_of_bounds"],
    ["sub-cent amount", { kind: "counter", dollars: 100.005 }, "sub_cent_amount"],
    ["missing amount on a counter", { kind: "counter" }, "missing_amount"],
    ["missing amount on an open", { kind: "open", dollars: null }, "missing_amount"],
    ["unknown offer kind", { kind: "unknown" }, "offer_kind_unknown"],
  ] satisfies Array<[string, OfferSpec, string]>)(
    "rejects %s as a round_failed no-op (%#)",
    (_label, spec, reason) => {
      const rec = active();
      const res = transition(rec, offerEv(1, spec), at(4));
      expect(res.next).toBe(rec); // record untouched: no round, no epoch bump
      expect(res.next.rounds).toEqual([]);
      expect(res.next.epoch).toBe(3);
      expect(res.ledgerEvents).toEqual([
        {
          type: "round_failed",
          payload: {
            round: 1,
            callee: "A",
            callId: "call_r1",
            outcome: "completed",
            reason,
          },
        },
      ]);
    },
  );

  it("rejects a non-completed call as round_failed carrying the outcome", () => {
    const rec = active();
    const res = transition(rec, offerEv(1, { kind: "counter", dollars: 500, outcome: "no_answer" }), at(4));
    expect(res.next).toBe(rec);
    expect(res.ledgerEvents[0]?.type).toBe("round_failed");
    expect(res.ledgerEvents[0]?.payload).toMatchObject({
      outcome: "no_answer",
      reason: "call_outcome_no_answer",
    });
  });

  it("rejects a missing or unparseable structured result as round_failed", () => {
    const rec = active();
    const noneRes = transition(rec, offerEv(1, { kind: "counter", structured: null }), at(4));
    expect(noneRes.ledgerEvents[0]?.payload).toMatchObject({ reason: "no_structured_result" });
    const badRes = transition(rec, offerEv(1, { kind: "counter", structured: { nope: 1 } }), at(4));
    expect(badRes.ledgerEvents[0]?.payload).toMatchObject({ reason: "unparseable_offer" });
    expect(noneRes.next).toBe(rec);
    expect(badRes.next).toBe(rec);
  });

  it("an accept without a restated amount takes the standing offer", () => {
    const withOffer = applyEvents(
      { rec: active(), entries: [] },
      [offerEv(1, { kind: "open", dollars: 700 })],
      3,
    ).rec;
    const res = transition(withOffer, offerEv(2, { kind: "accept" }), at(5));
    expect(res.next.state).toBe("attestation_pending_a");
    expect(res.next.settlement?.amountCents).toBe(70_000);
    expect(res.next.rounds[1]?.offer?.amountCents).toBe(70_000);
  });

  it("an accept that restates nothing inherits the standing offer's amount AND conditions", () => {
    const withOffer = applyEvents(
      { rec: active(), entries: [] },
      [offerEv(1, { kind: "open", dollars: 700, conditions: ["tenant returns the garage remote"] })],
      3,
    ).rec;
    const res = transition(withOffer, offerEv(2, { kind: "accept" }), at(5));
    expect(res.next.settlement?.amountCents).toBe(70_000);
    expect(res.next.settlement?.conditions).toEqual(["tenant returns the garage remote"]);
    expect(res.next.settlement?.termsDigest).toBe(
      stubSettlement({
        amountCents: 70_000,
        conditions: ["tenant returns the garage remote"],
      }).termsDigest,
    );
  });

  it("merges the accepting party's own conditions after the standing ones, deduped", () => {
    const withOffer = applyEvents(
      { rec: active(), entries: [] },
      [offerEv(1, { kind: "open", dollars: 700, conditions: ["return the mailbox keys"] })],
      3,
    ).rec;
    const res = transition(
      withOffer,
      offerEv(2, {
        kind: "accept",
        dollars: 700,
        conditions: ["Return the Mailbox Keys", "paid within 10 days"],
      }),
      at(5),
    );
    expect(res.next.settlement?.conditions).toEqual([
      "return the mailbox keys",
      "paid within 10 days",
    ]);
  });

  it("an accept with no standing offer at all fails", () => {
    const rec = active();
    const res = transition(rec, offerEv(1, { kind: "accept" }), at(4));
    expect(res.next).toBe(rec);
    expect(res.ledgerEvents[0]?.payload).toMatchObject({ reason: "accept_without_standing_offer" });
  });

  it("IDEMPOTENT: a re-delivered round result (stale round number) is a no-op", () => {
    const first = transition(active(), offerEv(1, { kind: "open", dollars: 700 }), at(4));
    const replay = transition(first.next, offerEv(1, { kind: "open", dollars: 700 }), at(4));
    expect(replay.next).toBe(first.next);
    expect(replay.next.epoch).toBe(first.next.epoch);
    expect(replay.next.rounds).toHaveLength(1);
    expect(replay.ledgerEvents).toEqual([]);
  });

  it("an out-of-order (future) round number is a no-op", () => {
    const rec = active();
    for (const round of [0, 2, 5, 99]) {
      const res = transition(rec, offerEv(round, { kind: "open", dollars: 700 }), at(4));
      expect(res.next).toBe(rec);
      expect(res.ledgerEvents).toEqual([]);
    }
  });

  it("a round result outside rounds_active is a no-op", () => {
    for (const state of ["created", "consent_pending_a", "attestation_pending_a"] as CaseState[]) {
      const rec: CaseRecord = { ...newCase(), state };
      const res = transition(rec, offerEv(1, { kind: "open", dollars: 700 }), at(4));
      expect(res.next).toBe(rec);
      expect(res.ledgerEvents).toEqual([]);
    }
  });

  it("reaching maxRounds without agreement ends in impasse", () => {
    const rec = active({ policy: makePolicy({ maxRounds: 2 }) });
    const r1 = transition(rec, offerEv(1, { kind: "open", dollars: 700 }), at(4));
    expect(r1.next.state).toBe("rounds_active");
    const r2 = transition(r1.next, offerEv(2, { kind: "counter", dollars: 400 }), at(5));
    expect(r2.next.state).toBe("impasse");
    expect(draftTypes(r2.ledgerEvents)).toEqual(["offer_recorded", "case_impasse"]);
    expect(r2.ledgerEvents[1]?.payload).toEqual({
      reason: "max_rounds_exhausted",
      roundsCompleted: 2,
    });
  });

  it("an accept on the final allowed round settles instead of hitting impasse", () => {
    const rec = active({ policy: makePolicy({ maxRounds: 2 }) });
    const r1 = transition(rec, offerEv(1, { kind: "open", dollars: 700 }), at(4));
    const r2 = transition(r1.next, offerEv(2, { kind: "accept", dollars: 700 }), at(5));
    expect(r2.next.state).toBe("attestation_pending_a");
    expect(draftTypes(r2.ledgerEvents)).toEqual(["offer_recorded", "settlement_proposed"]);
  });

  it("an engine impasse verdict terminates the case with the engine's reason", () => {
    const seen: CaseRecord[] = [];
    const withEngine = makeTransition({
      computeSettlement: stubSettlement,
      assessImpasse: (rec) => {
        seen.push(rec);
        return rec.rounds.length >= 2
          ? { impasse: true, impasseReason: "stall: party B repeated 400.00" }
          : { impasse: false };
      },
    });
    const r1 = withEngine(active(), offerEv(1, { kind: "open", dollars: 700 }), at(4));
    expect(r1.next.state).toBe("rounds_active");
    const r2 = withEngine(r1.next, offerEv(2, { kind: "counter", dollars: 400 }), at(5));
    expect(r2.next.state).toBe("impasse");
    expect(draftTypes(r2.ledgerEvents)).toEqual(["offer_recorded", "case_impasse"]);
    expect(r2.ledgerEvents[1]?.payload).toEqual({
      reason: "stall: party B repeated 400.00",
      roundsCompleted: 2,
    });
    // The engine sees the just-recorded round and the epoch it is about to have.
    expect(seen.map((r) => r.rounds.length)).toEqual([1, 2]);
    expect(seen.map((r) => r.epoch)).toEqual([4, 5]);
  });
});

// ---------- Attestation ----------

describe("attestation", () => {
  function pendingA(): { rec: CaseRecord; phrase: string } {
    const events = settledEvents();
    const rec = applyEvents(startRun(newCase()), events.slice(0, 7), 0).rec;
    expect(rec.state).toBe("attestation_pending_a");
    return { rec, phrase: (rec.settlement as Settlement).attestationPhrase };
  }

  it("a matching phrase from A moves to attestation_pending_b without settling", () => {
    const { rec, phrase } = pendingA();
    const res = transition(rec, attestEv("A", phrase), at(8));
    expect(res.next.state).toBe("attestation_pending_b");
    expect(draftTypes(res.ledgerEvents)).toEqual(["attestation_recorded"]);
    expect(res.next.settlement?.attestations.A).toEqual({
      callId: "call_attest_A",
      spokenPhrase: phrase,
      verified: true,
      at: at(8),
    });
    expect(res.next.settlement?.attestations.B).toBeUndefined();
  });

  it("tolerates capitalization and punctuation in the transcribed phrase", () => {
    const { rec, phrase } = pendingA();
    const spoken = `${phrase.toUpperCase().split(" ").join(", ")}.`;
    const res = transition(rec, attestEv("A", spoken), at(8));
    expect(res.next.state).toBe("attestation_pending_b");
    expect(res.next.settlement?.attestations.A?.spokenPhrase).toBe(spoken); // verbatim in the record
  });

  it("a mismatched phrase does NOT settle and leaves the case pending", () => {
    const { rec, phrase } = pendingA();
    for (const wrong of ["anchor basalt", `${phrase} harbor`, "granite dune ember", ""]) {
      if (normalizePhrase(wrong) === normalizePhrase(phrase)) continue;
      const res = transition(rec, attestEv("A", wrong), at(8));
      expect(res.next).toBe(rec);
      expect(res.next.state).toBe("attestation_pending_a");
      expect(res.next.epoch).toBe(rec.epoch);
      expect(res.ledgerEvents).toEqual([]);
    }
  });

  it("both matching phrases settle the case and draft case_settled", () => {
    const { rec, phrase } = pendingA();
    const a = transition(rec, attestEv("A", phrase), at(8));
    const b = transition(a.next, attestEv("B", phrase), at(9));
    expect(b.next.state).toBe("settled");
    expect(draftTypes(b.ledgerEvents)).toEqual(["attestation_recorded", "case_settled"]);
    expect(b.next.settlement?.attestations.A?.verified).toBe(true);
    expect(b.next.settlement?.attestations.B?.verified).toBe(true);
    expect(b.next.epoch).toBe(a.next.epoch + 1);
  });

  it("attestation from the wrong party is a no-op", () => {
    const { rec, phrase } = pendingA();
    const res = transition(rec, attestEv("B", phrase), at(8));
    expect(res.next).toBe(rec);
    expect(res.ledgerEvents).toEqual([]);
  });

  it("a non-completed call or missing phrase is a no-op", () => {
    const { rec, phrase } = pendingA();
    const failed: CaseEvent = {
      kind: "attestation_result",
      party: "A",
      result: callResult("call_x", { phrase_spoken: phrase }, { outcome: "no_answer" }),
    };
    const missing: CaseEvent = {
      kind: "attestation_result",
      party: "A",
      result: callResult("call_x", { spoken: phrase }),
    };
    const nullStructured: CaseEvent = {
      kind: "attestation_result",
      party: "A",
      result: callResult("call_x", null),
    };
    expect(transition(rec, failed, at(8)).next).toBe(rec);
    expect(transition(rec, missing, at(8)).next).toBe(rec);
    expect(transition(rec, nullStructured, at(8)).next).toBe(rec);
  });

  it("IDEMPOTENT: re-delivering A's attestation while B is pending is a no-op", () => {
    const { rec, phrase } = pendingA();
    const a = transition(rec, attestEv("A", phrase), at(8));
    const replay = transition(a.next, attestEv("A", phrase), at(8));
    expect(replay.next).toBe(a.next);
    expect(replay.next.epoch).toBe(a.next.epoch);
    expect(replay.ledgerEvents).toEqual([]);
  });

  it("IDEMPOTENT: a double delivery for an already-verified party is a no-op", () => {
    const { rec, phrase } = pendingA();
    const settlement = rec.settlement as Settlement;
    // Pathological but reachable after a torn write: A verified, state not advanced.
    const stuck: CaseRecord = {
      ...rec,
      settlement: {
        ...settlement,
        attestations: {
          A: { callId: "call_attest_A", spokenPhrase: phrase, verified: true, at: at(8) },
        },
      },
    };
    const res = transition(stuck, attestEv("A", phrase), at(9));
    expect(res.next).toBe(stuck);
    expect(res.ledgerEvents).toEqual([]);
  });

  it("an attestation with no settlement on the record is a no-op", () => {
    const { rec, phrase } = pendingA();
    const { settlement: _dropped, ...withoutSettlement } = rec;
    const res = transition(withoutSettlement, attestEv("A", phrase), at(8));
    expect(res.next).toBe(withoutSettlement);
    expect(res.ledgerEvents).toEqual([]);
  });
});

// ---------- Tick, cancel, terminal states ----------

describe("tick", () => {
  it("moves created -> consent_pending_a with NO ledger events (the one silent step)", () => {
    const rec = newCase();
    const res = transition(rec, { kind: "tick", now: at(1) }, at(1));
    expect(res.next.state).toBe("consent_pending_a");
    expect(res.next.epoch).toBe(1);
    expect(res.ledgerEvents).toEqual([]);
  });

  it("expires the case at the TTL boundary and after it", () => {
    const rec = newCase({ policy: { ttlHours: 1 } });
    const early = transition(rec, { kind: "tick", now: at(59) }, at(59));
    expect(early.next.state).toBe("consent_pending_a"); // not expired yet

    for (const minutes of [60, 61, 6000]) {
      const res = transition(rec, { kind: "tick", now: at(minutes) }, at(minutes));
      expect(res.next.state).toBe("expired");
      expect(res.next.epoch).toBe(1);
      expect(res.ledgerEvents).toEqual([
        { type: "case_expired", payload: { ttlHours: 1, expiredAt: at(minutes) } },
      ]);
    }
  });

  it("expiry wins over any other pending work", () => {
    const rec: CaseRecord = {
      ...newCase({ policy: { ttlHours: 1 } }),
      state: "attestation_pending_b",
      epoch: 7,
    };
    const res = transition(rec, { kind: "tick", now: at(120) }, at(120));
    expect(res.next.state).toBe("expired");
    expect(res.next.epoch).toBe(8);
  });

  it("is a no-op in states that only wait on calls", () => {
    for (const state of [
      "consent_pending_a",
      "consent_pending_b",
      "attestation_pending_a",
      "attestation_pending_b",
    ] as CaseState[]) {
      const rec: CaseRecord = { ...newCase(), state, epoch: 4 };
      const res = transition(rec, { kind: "tick", now: at(5) }, at(5));
      expect(res.next).toBe(rec);
      expect(res.ledgerEvents).toEqual([]);
    }
  });

  it("is a no-op mid-negotiation while rounds remain", () => {
    const rec = applyEvents(
      { rec: { ...newCase(), state: "rounds_active", epoch: 3 }, entries: [] },
      [offerEv(1, { kind: "open", dollars: 700 })],
      3,
    ).rec;
    const res = transition(rec, { kind: "tick", now: at(6) }, at(6));
    expect(res.next).toBe(rec);
    expect(res.ledgerEvents).toEqual([]);
  });

  it("derives impasse on resume when the round limit is already spent", () => {
    // A crash could persist offer_recorded and lose case_impasse; the resume
    // tick must re-derive the terminal state.
    const rounds = applyEvents(
      {
        rec: { ...newCase({ policy: { maxRounds: 2 } }), state: "rounds_active", epoch: 3 },
        entries: [],
      },
      [offerEv(1, { kind: "open", dollars: 700 })],
      3,
    ).rec;
    const stuck: CaseRecord = {
      ...rounds,
      rounds: [
        ...rounds.rounds,
        {
          n: 2,
          callee: "B",
          callId: "call_r2",
          offer: { kind: "counter", amountCents: 40_000, conditions: [], evidence: [] },
          outcome: "completed",
          startedAt: at(5),
          completedAt: at(5),
        },
      ],
    };
    const res = transition(stuck, { kind: "tick", now: at(6) }, at(6));
    expect(res.next.state).toBe("impasse");
    expect(res.ledgerEvents).toEqual([
      { type: "case_impasse", payload: { reason: "max_rounds_exhausted", roundsCompleted: 2 } },
    ]);
  });

  it("heals a torn accept to the SAME terms the live path proposed", () => {
    // The standing offer carries a condition the accepting call never restated.
    // The live accept path merges it into the settlement; the heal path must
    // reach the identical digest, or a crash silently changes the agreement
    // (and the attestation phrase both parties are read).
    const live = applyEvents(
      { rec: { ...newCase(), state: "rounds_active", epoch: 3 }, entries: [] },
      [
        offerEv(1, { kind: "open", dollars: 700, conditions: ["return the mailbox keys"] }),
        offerEv(2, { kind: "accept" }),
      ],
      3,
    ).rec;
    const liveSettlement = live.settlement as Settlement;
    expect(liveSettlement.conditions).toEqual(["return the mailbox keys"]);

    const { settlement: _lost, ...torn } = live;
    const healed = transition(
      { ...torn, state: "rounds_active" },
      { kind: "tick", now: at(6) },
      at(6),
    ).next;
    expect(healed.state).toBe("attestation_pending_a");
    expect(healed.settlement?.conditions).toEqual(liveSettlement.conditions);
    expect(healed.settlement?.termsDigest).toBe(liveSettlement.termsDigest);
    expect(healed.settlement?.attestationPhrase).toBe(liveSettlement.attestationPhrase);
  });

  it("heals a torn accept: an accepted round with no settlement re-proposes one", () => {
    const events = settledEvents();
    const upToAccept = applyEvents(startRun(newCase()), events.slice(0, 7), 0).rec;
    const { settlement: _lost, ...torn } = upToAccept;
    const rec: CaseRecord = { ...torn, state: "rounds_active" };
    const res = transition(rec, { kind: "tick", now: at(8) }, at(8));
    expect(res.next.state).toBe("attestation_pending_a");
    expect(draftTypes(res.ledgerEvents)).toEqual(["settlement_proposed"]);
    expect(res.next.settlement?.amountCents).toBe(SETTLED_AMOUNT_CENTS);
    expect(res.next.settlement?.attestationPhrase).toBe(
      (upToAccept.settlement as Settlement).attestationPhrase,
    );
  });
});

describe("cancel and terminal states", () => {
  it("cancel terminates the case and records the reason", () => {
    const rec: CaseRecord = { ...newCase(), state: "rounds_active", epoch: 5 };
    const res = transition(rec, { kind: "cancel", reason: "party_a_retained_counsel" }, at(9));
    expect(res.next.state).toBe("cancelled");
    expect(res.next.epoch).toBe(6);
    expect(res.ledgerEvents).toEqual([
      { type: "case_cancelled", payload: { reason: "party_a_retained_counsel" } },
    ]);
  });

  it("every terminal state ignores every event kind", () => {
    const terminal: CaseState[] = ["settled", "impasse", "declined_consent", "expired", "cancelled"];
    const events: CaseEvent[] = [
      consentEv("A", "yes"),
      consentEv("B", "no"),
      offerEv(1, { kind: "open", dollars: 700 }),
      attestEv("A", "anchor basalt cobalt"),
      { kind: "cancel", reason: "again" },
      { kind: "tick", now: at(10) },
      { kind: "tick", now: at(100_000) }, // long past the TTL
    ];
    for (const state of terminal) {
      const rec: CaseRecord = { ...newCase(), state, epoch: 9 };
      for (const ev of events) {
        const res = transition(rec, ev, at(11));
        expect(res.next).toBe(rec);
        expect(res.next.epoch).toBe(9);
        expect(res.ledgerEvents).toEqual([]);
      }
    }
  });
});

// ---------- rehydrate ----------

describe("rehydrate", () => {
  function manualEntries(
    drafts: Array<{ type: LedgerEventType; payload: Record<string, unknown>; caseId?: string; epoch?: number }>,
  ): LedgerEntry[] {
    const entries: LedgerEntry[] = [];
    drafts.forEach((d, i) => {
      appendDrafts(entries, d.caseId ?? CASE_ID, d.epoch ?? i, [d], at(i));
    });
    return entries;
  }

  it("rebuilds a settled case from a real sqlite ledger, byte-for-byte", () => {
    const ledger = openLedger(":memory:");
    try {
      let rec = newCase();
      const genesis = genesisEvent(rec);
      ledger.append({
        caseId: rec.caseId,
        epoch: rec.epoch,
        type: genesis.type,
        payload: genesis.payload,
        at: rec.createdAt,
      });
      settledEvents().forEach((ev, i) => {
        const when = at(i + 1);
        const event: CaseEvent = ev.kind === "tick" ? { ...ev, now: when } : ev;
        const res = transition(rec, event, when);
        if (res.ledgerEvents.length > 0) {
          ledger.appendMany(
            res.ledgerEvents.map((d) => ({
              caseId: rec.caseId,
              epoch: res.next.epoch,
              type: d.type,
              payload: d.payload,
              at: when,
            })),
          );
        }
        rec = res.next;
      });

      expect(rec.state).toBe("settled");
      expect(ledger.verifyChain(CASE_ID)).toEqual({ ok: true });
      const rehydrated = rehydrate(CASE_ID, ledger.entries(CASE_ID));
      expect(project(rehydrated)).toEqual(project(rec));
      expect(rehydrated.state).toBe("settled");
      expect(rehydrated.epoch).toBe(rec.epoch);
      expect(rehydrated.rounds).toEqual(rec.rounds);
      expect(rehydrated.settlement).toEqual(rec.settlement);
    } finally {
      ledger.close();
    }
  });

  it("ignores entries belonging to other cases", () => {
    const mine = applyEvents(startRun(newCase()), settledEvents(), 0);
    const foreign: LedgerEntry[] = mine.entries.map((e, i) => ({
      ...e,
      seq: 1000 + i,
      caseId: "cs_other_9999",
    }));
    const rehydrated = rehydrate(CASE_ID, [...foreign, ...mine.entries]);
    expect(project(rehydrated)).toEqual(project(mine.rec));
  });

  it("sorts by seq, so entry order in the input array does not matter", () => {
    const { rec, entries } = applyEvents(startRun(newCase()), settledEvents(), 0);
    const shuffled = [...entries].reverse();
    expect(project(rehydrate(CASE_ID, shuffled))).toEqual(project(rec));
  });

  it("records updatedAt from the last state-changing entry", () => {
    const { entries } = applyEvents(startRun(newCase()), settledEvents(), 0);
    const rehydrated = rehydrate(CASE_ID, entries);
    expect(rehydrated.updatedAt).toBe(entries[entries.length - 1]?.at);
  });

  it("throws loudly on a structurally corrupt ledger", () => {
    expect(() => rehydrate(CASE_ID, [])).toThrow(/no ledger entries/);

    const noGenesis = manualEntries([
      { type: "consent_recorded", payload: { party: "A" } },
    ]);
    expect(() => rehydrate(CASE_ID, noGenesis)).toThrow(/does not begin with case_created/);

    const base = newCase();
    const genesisPayload = genesisEvent(base).payload;
    const wrongCase = manualEntries([
      { type: "case_created", payload: { ...genesisPayload, caseId: "cs_someone_else" } },
    ]);
    expect(() => rehydrate(CASE_ID, wrongCase)).toThrow(/does not match/);

    const duplicated = manualEntries([
      { type: "case_created", payload: genesisPayload },
      { type: "case_created", payload: genesisPayload },
    ]);
    expect(() => rehydrate(CASE_ID, duplicated)).toThrow(/duplicate case_created/);

    const roundGap = manualEntries([
      { type: "case_created", payload: genesisPayload },
      {
        type: "offer_recorded",
        payload: {
          round: {
            n: 5,
            callee: "A",
            callId: "call_r5",
            offer: { kind: "counter", amountCents: 1, conditions: [], evidence: [] },
            outcome: "completed",
            startedAt: at(1),
            completedAt: at(1),
          },
        },
      },
    ]);
    expect(() => rehydrate(CASE_ID, roundGap)).toThrow(/records round 5 after 0 rounds/);

    const orphanAttestation = manualEntries([
      { type: "case_created", payload: genesisPayload },
      {
        type: "attestation_recorded",
        payload: {
          party: "A",
          attestation: { callId: "call_x", spokenPhrase: "anchor", verified: true, at: at(1) },
        },
      },
    ]);
    expect(() => rehydrate(CASE_ID, orphanAttestation)).toThrow(/attestation before settlement/);
  });

  it("treats audit-only round_failed entries as state-neutral", () => {
    const base = newCase();
    const events: CaseEvent[] = [
      { kind: "tick", now: T0 },
      consentEv("A", "yes"),
      consentEv("B", "yes"),
      offerEv(1, { kind: "counter", dollars: 5000 }), // out of bounds -> round_failed
      offerEv(1, { kind: "open", dollars: 700 }),
    ];
    const { rec, entries } = applyEvents(startRun(base), events, 0);
    expect(entries.map((e) => e.type)).toContain("round_failed");
    expect(project(rehydrate(CASE_ID, entries))).toEqual(project(rec));
    expect(rec.rounds).toHaveLength(1);
  });

  it("CRASH RESUME: every prefix of a settling run replays to the same final record", () => {
    assertCrashResumeEquivalence(newCase(), settledEvents());
  });

  it("CRASH RESUME: every prefix of an impasse run replays to the same final record", () => {
    const events: CaseEvent[] = [
      { kind: "tick", now: T0 },
      consentEv("A", "yes"),
      consentEv("B", "yes"),
      offerEv(1, { kind: "open", dollars: 900 }),
      offerEv(2, { kind: "counter", dollars: 100 }),
      offerEv(3, { kind: "counter", dollars: 890 }),
      offerEv(4, { kind: "counter", dollars: 110 }),
      attestEv("A", "anchor basalt cobalt"), // ignored: case is terminal
    ];
    assertCrashResumeEquivalence(newCase({ policy: { maxRounds: 4 } }), events);
  });

  it("CRASH RESUME: every prefix of a declined / cancelled run replays identically", () => {
    assertCrashResumeEquivalence(newCase(), [
      { kind: "tick", now: T0 },
      consentEv("A", "no"),
      consentEv("B", "yes"),
    ]);
    assertCrashResumeEquivalence(newCase(), [
      { kind: "tick", now: T0 },
      consentEv("A", "yes"),
      { kind: "cancel", reason: "withdrawn" },
      consentEv("B", "yes"),
    ]);
  });

  it("CRASH RESUME: a run that expires on a tick replays identically", () => {
    assertCrashResumeEquivalence(newCase({ policy: { ttlHours: 0.05 } }), [
      { kind: "tick", now: T0 }, // at(1): inside the 3-minute TTL
      consentEv("A", "yes"),
      { kind: "tick", now: T0 }, // at(3): exactly at the TTL boundary
      consentEv("B", "yes"), // ignored: terminal
    ]);
  });

  it("property: any offer sequence replays identically from every crash point", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1200 }), { minLength: 2, maxLength: 5 }),
        fc.boolean(),
        (dollars, closes) => {
          const base = newCase();
          const rounds: CaseEvent[] = dollars.map((d, i) =>
            offerEv(i + 1, {
              kind: i === 0 ? "open" : closes && i === dollars.length - 1 ? "accept" : "counter",
              dollars: d,
            }),
          );
          const events: CaseEvent[] = [
            { kind: "tick", now: T0 },
            consentEv("A", "yes"),
            consentEv("B", "yes"),
            ...rounds,
          ];
          const lastDollars = dollars[dollars.length - 1] as number;
          if (closes && dollars.length > 1) {
            const phrase = stubSettlement({
              amountCents: lastDollars * 100,
              conditions: [],
            }).attestationPhrase;
            events.push(attestEv("A", phrase), attestEv("B", phrase));
          }

          const full = applyEvents(startRun(base), events, 0);
          // Every event in this generator is accepted, so epoch == event count.
          expect(full.rec.epoch).toBe(events.length);
          if (closes && dollars.length > 1) {
            expect(full.rec.state).toBe("settled");
            expect(full.rec.settlement?.amountCents).toBe(lastDollars * 100);
          } else {
            expect(full.rec.state).toBe("rounds_active");
            expect(full.rec.rounds).toHaveLength(dollars.length);
          }
          assertCrashResumeEquivalence(base, events);
        },
      ),
      { numRuns: 30 },
    );
  });

  it("a genesis-only ledger rebuilds the pre-outreach record, which the resume tick advances", () => {
    // `created -> consent_pending_a` is the one transition that writes nothing,
    // so replay alone cannot know it happened. The orchestrator's resume tick
    // is what re-derives it — and doing so twice is still harmless.
    const rec = newCase();
    const { entries } = startRun(rec);
    const rehydrated = rehydrate(CASE_ID, entries);
    expect(rehydrated.state).toBe("created");
    expect(rehydrated.epoch).toBe(0);
    expect(rehydrated.rounds).toEqual([]);

    const resumed = transition(rehydrated, { kind: "tick", now: at(1) }, at(1));
    expect(resumed.next.state).toBe("consent_pending_a");
    expect(resumed.ledgerEvents).toEqual([]);
    const again = transition(resumed.next, { kind: "tick", now: at(2) }, at(2));
    expect(again.next).toBe(resumed.next);
  });

  it("property: delivering every webhook twice yields the identical final record", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1200 }), { minLength: 2, maxLength: 5 }),
        (dollars) => {
          const base = newCase();
          const rounds: CaseEvent[] = dollars.map((d, i) =>
            offerEv(i + 1, {
              kind: i === 0 ? "open" : i === dollars.length - 1 ? "accept" : "counter",
              dollars: d,
            }),
          );
          const phrase = stubSettlement({
            amountCents: (dollars[dollars.length - 1] as number) * 100,
            conditions: [],
          }).attestationPhrase;
          const events: CaseEvent[] = [
            { kind: "tick", now: T0 },
            consentEv("A", "yes"),
            consentEv("B", "yes"),
            ...rounds,
            attestEv("A", phrase),
            attestEv("B", phrase),
          ];
          const once = applyEvents(startRun(base), events, 0).rec;
          const twice = applyEvents(
            startRun(base),
            events.flatMap((ev) => [ev, ev]),
            0,
          ).rec;
          expect(once.state).toBe("settled");
          // Timeless: the duplicates shift later events' clocks, nothing else.
          expect(projectTimeless(twice)).toEqual(projectTimeless(once));
          expect(twice.epoch).toBe(once.epoch);
        },
      ),
      { numRuns: 40 },
    );
  });
});

// ---------- Offer extraction: the remaining rejection paths ----------

const roundsActive = (overrides: Partial<CaseRecord> = {}): CaseRecord => ({
  ...newCase(),
  state: "rounds_active",
  epoch: 3,
  ...overrides,
});

/** Build a rounds_active record that already holds the given offers. */
function withRounds(specs: OfferSpec[], overrides: Partial<CaseRecord> = {}): CaseRecord {
  const rec = applyEvents(
    { rec: roundsActive(overrides), entries: [] },
    specs.map((spec, i) => offerEv(i + 1, spec)),
    3,
  ).rec;
  expect(rec.rounds).toHaveLength(specs.length);
  return rec;
}

describe("offer extraction edge cases", () => {
  it("rejects non-finite amounts at the schema, before any cent conversion", () => {
    const rec = roundsActive();
    for (const dollars of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const res = transition(rec, offerEv(1, { kind: "counter", dollars }), at(4));
      expect(res.next).toBe(rec);
      expect(res.ledgerEvents[0]?.payload).toMatchObject({ reason: "unparseable_offer" });
    }
    // A string amount is likewise a schema failure, never a coerced number.
    const coerced = transition(
      rec,
      offerEv(1, { kind: "counter", structured: { offer_kind: "counter", amount_dollars: "700" } }),
      at(4),
    );
    expect(coerced.next).toBe(rec);
    expect(coerced.ledgerEvents[0]?.payload).toMatchObject({ reason: "unparseable_offer" });
  });

  it("rejects a negative sub-cent amount as sub-cent, not as out of bounds", () => {
    const rec = roundsActive();
    const res = transition(rec, offerEv(1, { kind: "counter", dollars: -0.005 }), at(4));
    expect(res.ledgerEvents[0]?.payload).toMatchObject({ reason: "sub_cent_amount" });
  });

  it("tolerates IEEE-754 round-trip noise while still rejecting a real half cent", () => {
    const rec = roundsActive();
    // 0.07 * 100 === 7.000000000000001 — noise from cents/100, not a half cent.
    const noisy = transition(rec, offerEv(1, { kind: "open", dollars: 0.07 }), at(4));
    expect(noisy.next.rounds[0]?.offer?.amountCents).toBe(7);
    const real = transition(rec, offerEv(1, { kind: "open", dollars: 10.005 }), at(4));
    expect(real.next).toBe(rec);
    expect(real.ledgerEvents[0]?.payload).toMatchObject({ reason: "sub_cent_amount" });
  });

  it("strips unknown keys from a structured result instead of failing on them", () => {
    const rec = roundsActive();
    const res = transition(
      rec,
      offerEv(1, {
        kind: "open",
        structured: {
          offer_kind: "open",
          amount_dollars: 700,
          model_confidence: 0.42,
          debug: { tokens: 91 },
        },
      }),
      at(4),
    );
    expect(draftTypes(res.ledgerEvents)).toEqual(["offer_recorded"]);
    expect(res.next.rounds[0]?.offer).toEqual({
      kind: "open",
      amountCents: 70_000,
      conditions: [],
      evidence: [],
    });
  });

  it("re-delivering a FAILED round re-files the audit entry but still changes nothing", () => {
    // Honest limit: `round_failed` is audit-only (rehydrate treats it as
    // state-neutral), so a duplicate webhook for a failed call writes a second
    // audit line. What it must never do is advance the case.
    const rec = roundsActive();
    const ev = offerEv(1, { kind: "counter", structured: null });
    const first = transition(rec, ev, at(4));
    const second = transition(first.next, ev, at(5));
    expect(second.next).toBe(rec);
    expect(second.next.epoch).toBe(rec.epoch);
    expect(second.next.rounds).toEqual([]);
    expect(draftTypes(second.ledgerEvents)).toEqual(["round_failed"]);
  });
});

// ---------- Accept: resolving the standing offer ----------

describe("accept semantics: standing offer resolution", () => {
  it("takes the conditions of the other side's newest priced offer, skipping its reject", () => {
    // A opens, B counters (with a condition), A counters, B rejects outright,
    // A accepts. The standing terms are B's round-2 counter — the search walks
    // back past B's unpriced reject and never picks up A's own asks.
    const rec = withRounds([
      { kind: "open", dollars: 700, conditions: ["return the mailbox keys"] },
      { kind: "counter", dollars: 400, conditions: ["landlord pays the cleaning fee"] },
      { kind: "counter", dollars: 600, conditions: ["split the cleaning fee"] },
      { kind: "reject" },
    ]);
    const res = transition(rec, offerEv(5, { kind: "accept", dollars: 600 }), at(9));
    expect(res.next.state).toBe("attestation_pending_a");
    expect(res.next.settlement?.conditions).toEqual(["landlord pays the cleaning fee"]);
    expect(res.next.settlement?.amountCents).toBe(60_000);
  });

  it("inherits the newest amount on record, even when it is the accepting side's own", () => {
    // Documented, not endorsed: when the other side's last word carried no
    // number, `latestOfferAmountCents` falls back to whatever offer is newest —
    // here A's own counter. Dual attestation is what protects B from it.
    const rec = withRounds([
      { kind: "open", dollars: 700, conditions: ["return the mailbox keys"] },
      { kind: "counter", dollars: 400, conditions: ["landlord pays the cleaning fee"] },
      { kind: "counter", dollars: 600 },
      { kind: "reject" },
    ]);
    const res = transition(rec, offerEv(5, { kind: "accept" }), at(9));
    expect(res.next.settlement?.amountCents).toBe(60_000);
    expect(res.next.settlement?.conditions).toEqual(["landlord pays the cleaning fee"]);
  });

  it("drops blank conditions and keeps the standing offer's wording on a duplicate", () => {
    const rec = withRounds([
      { kind: "open", dollars: 700, conditions: ["Return the Mailbox Keys"] },
    ]);
    const res = transition(
      rec,
      offerEv(2, {
        kind: "accept",
        dollars: 700,
        conditions: ["  return the mailbox keys  ", "   ", "", "paid by certified check"],
      }),
      at(5),
    );
    expect(res.next.settlement?.conditions).toEqual([
      "Return the Mailbox Keys",
      "paid by certified check",
    ]);
  });

  it("validates the amount an accept restates against the dispute bounds", () => {
    const rec = withRounds([{ kind: "open", dollars: 700 }]);
    const res = transition(rec, offerEv(2, { kind: "accept", dollars: 1201 }), at(5));
    expect(res.next).toBe(rec);
    expect(res.next.settlement).toBeUndefined();
    expect(res.ledgerEvents[0]?.payload).toMatchObject({ reason: "amount_out_of_bounds" });
  });
});

// ---------- Engine hook, purity, clocks ----------

describe("engine hook, purity and clocks", () => {
  it("falls back to a generic reason when the engine names none", () => {
    const withEngine = makeTransition({
      computeSettlement: stubSettlement,
      assessImpasse: () => ({ impasse: true }),
    });
    const res = withEngine(roundsActive(), offerEv(1, { kind: "open", dollars: 700 }), at(4));
    expect(res.next.state).toBe("impasse");
    expect(res.ledgerEvents[1]?.payload).toEqual({ reason: "engine_impasse", roundsCompleted: 1 });
  });

  it("never lets an impasse verdict override an accept", () => {
    const withEngine = makeTransition({
      computeSettlement: stubSettlement,
      assessImpasse: () => ({ impasse: true, impasseReason: "always" }),
    });
    // An always-impasse engine would have ended the case on any counter, but
    // the accept branch settles before the engine is ever consulted.
    const rec = withRounds([{ kind: "open", dollars: 700 }]);
    expect(withEngine(rec, offerEv(2, { kind: "counter", dollars: 650 }), at(5)).next.state).toBe(
      "impasse",
    );
    const accepted = withEngine(rec, offerEv(2, { kind: "accept", dollars: 700 }), at(5));
    expect(accepted.next.state).toBe("attestation_pending_a");
    expect(draftTypes(accepted.ledgerEvents)).toEqual(["offer_recorded", "settlement_proposed"]);
    expect(accepted.next.settlement?.amountCents).toBe(70_000);
  });

  it("does not mutate the record it was handed", () => {
    const rec = withRounds([{ kind: "open", dollars: 700, conditions: ["return the keys"] }]);
    const before = structuredClone(rec);
    transition(rec, offerEv(2, { kind: "accept" }), at(5));
    transition(rec, { kind: "cancel", reason: "withdrawn" }, at(5));
    transition(rec, { kind: "tick", now: at(5) }, at(5));
    expect(rec).toEqual(before);
  });

  it("uses the tick's own clock, not the ambient one", () => {
    const res = transition(newCase(), { kind: "tick", now: at(30) }, at(999));
    expect(res.next.state).toBe("consent_pending_a");
    expect(res.next.updatedAt).toBe(at(30));
  });

  it("expires at the TTL millisecond, not a millisecond earlier", () => {
    const rec = newCase({ policy: { ttlHours: 2 } });
    const boundaryMs = T0_MS + 2 * 3_600_000;
    const justBefore = new Date(boundaryMs - 1).toISOString();
    const exactly = new Date(boundaryMs).toISOString();
    expect(transition(rec, { kind: "tick", now: justBefore }, justBefore).next.state).toBe(
      "consent_pending_a",
    );
    const expired = transition(rec, { kind: "tick", now: exactly }, exactly);
    expect(expired.next.state).toBe("expired");
    expect(expired.ledgerEvents).toEqual([
      { type: "case_expired", payload: { ttlHours: 2, expiredAt: exactly } },
    ]);
  });

  it("ignores a consent value that is merely close to a valid one", () => {
    const rec: CaseRecord = { ...newCase(), state: "consent_pending_a", epoch: 1 };
    for (const consent of ["YES", "Yes", "yes please", " yes", "y"]) {
      const res = transition(rec, consentEv("A", consent), at(2));
      expect(res.next).toBe(rec);
      expect(res.ledgerEvents).toEqual([]);
    }
  });

  it("ignores an attestation whose phrase is not even a string", () => {
    const events = settledEvents();
    const rec = applyEvents(startRun(newCase()), events.slice(0, 7), 0).rec;
    expect(rec.state).toBe("attestation_pending_a");
    const ev: CaseEvent = {
      kind: "attestation_result",
      party: "A",
      result: callResult("call_x", { phrase_spoken: 42 }),
    };
    const res = transition(rec, ev, at(8));
    expect(res.next).toBe(rec);
    expect(res.ledgerEvents).toEqual([]);
  });
});
