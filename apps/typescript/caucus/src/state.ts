/**
 * Caucus case state machine — the correctness core.
 *
 * Pure functions only: the `transition` built by {@link makeTransition} does
 * no I/O. It consumes {@link CaseEvent}s (call results, ticks, cancels) and
 * returns the next {@link CaseRecord} plus the ledger event drafts that make
 * the transition durable. Callers append those drafts atomically (see
 * `Ledger.appendMany`) stamped with the *next* record's epoch, and
 * {@link rehydrate} reconstructs any record from the ledger alone — crash
 * recovery is replay.
 *
 * Flow:
 *   created -> consent_pending_a -> consent_pending_b -> rounds_active
 *     -> (offer accepted) attestation_pending_a -> attestation_pending_b -> settled
 *   consent "no" -> declined_consent; maxRounds/engine impasse -> impasse;
 *   tick past TTL -> expired; cancel -> cancelled.
 *
 * Invariants:
 * - Idempotent + monotonic: a stale round number, an already-recorded party
 *   attestation, or any event that does not apply in the current state is a
 *   no-op returning the *same record instance*. Every accepted transition
 *   increments `epoch`.
 * - Money is integer cents within [0, dispute.amountCents]; out-of-bounds or
 *   sub-cent extractions are rejected as a `round_failed` no-op.
 * - `created -> consent_pending_a` (via tick) is the one ledger-silent
 *   transition; after a crash the orchestrator re-ticks a rehydrated record,
 *   which also re-derives any state lost to a torn (non-atomic) append.
 * - Settlement digesting is injected ({@link TransitionDeps.computeSettlement})
 *   so this module stays free of crypto/attestation concerns; the optional
 *   {@link TransitionDeps.assessImpasse} hook lets the negotiation engine
 *   terminate stalled cases without this module importing it.
 */

import { z } from "zod";
import type {
  Attestation,
  CasePolicy,
  CaseRecord,
  CaseEvent,
  CaseState,
  Dispute,
  EngineAssessment,
  LedgerEntry,
  LedgerEventType,
  Offer,
  Party,
  PartyId,
  Round,
  Settlement,
} from "./types.js";

// ---------- Public types ----------

export interface LedgerEventDraft {
  type: LedgerEventType;
  payload: Record<string, unknown>;
}

export interface TransitionResult {
  next: CaseRecord;
  ledgerEvents: LedgerEventDraft[];
}

export type Transition = (rec: CaseRecord, ev: CaseEvent, now: string) => TransitionResult;

export interface SettlementTerms {
  amountCents: number;
  conditions: string[];
}

/** Injected digest fn (see attest module) — deterministic for a given terms value. */
export type ComputeSettlement = (
  terms: SettlementTerms,
) => { termsDigest: string; attestationPhrase: string };

/** Injected negotiation-engine verdict; consulted after each recorded round and on ticks. */
export type AssessImpasse = (rec: CaseRecord) => Pick<EngineAssessment, "impasse" | "impasseReason">;

export interface TransitionDeps {
  computeSettlement: ComputeSettlement;
  assessImpasse?: AssessImpasse;
  /**
   * Compares a callee's spoken read-back against the settlement's attestation
   * token. Injected for the same reason `computeSettlement` is: what counts as
   * a faithful read-back is an attestation-domain question (digit codes accept
   * a bounded false start — a defect a live call exposed; see attest.ts), and
   * this module must stay free of those concerns. Defaults to normalized
   * equality, which is exact-match for digit codes.
   */
  verifySpoken?: (expected: string, spoken: string) => boolean;
}

export interface CreateCaseInput {
  caseId: string;
  dispute: Dispute;
  parties: [Party, Party];
  policy: CasePolicy;
}

// ---------- Small helpers ----------

const TERMINAL_STATES: ReadonlySet<CaseState> = new Set<CaseState>([
  "settled",
  "impasse",
  "declined_consent",
  "expired",
  "cancelled",
]);

export function isTerminal(state: CaseState): boolean {
  return TERMINAL_STATES.has(state);
}

/** Shuttle alternation: odd rounds call A, even rounds call B. */
export function calleeForRound(n: number): PartyId {
  return n % 2 === 1 ? "A" : "B";
}

/** Case- and punctuation-insensitive phrase comparison key. */
export function normalizePhrase(phrase: string): string {
  return phrase
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Whole-cent dollars -> integer cents. Returns null for non-finite or
 * sub-cent amounts (float noise from `cents / 100` round-trips is far below
 * the tolerance; a real half-cent like 10.005 is far above it).
 */
function dollarsToCents(dollars: number): number | null {
  if (!Number.isFinite(dollars)) return null;
  const cents = Math.round(dollars * 100);
  if (Math.abs(dollars * 100 - cents) > 0.01) return null;
  return cents;
}

function latestOfferAmountCents(rounds: readonly Round[]): number | undefined {
  for (let i = rounds.length - 1; i >= 0; i -= 1) {
    const amount = rounds[i]?.offer?.amountCents;
    if (amount !== undefined) return amount;
  }
  return undefined;
}

/**
 * The conditions attached to the standing proposal being accepted — i.e. the
 * most recent open/counter from the OTHER side.
 *
 * "I accept" rarely restates the other party's conditions, so taking the
 * accepting call's conditions alone would drop terms the offering party
 * required (e.g. "$700 *and you return the mailbox keys*") and produce a
 * memorandum that misstates the agreement. Conditions are therefore carried
 * forward and merged, never silently dropped; if the accepting party voices
 * extra conditions, those are appended, and the dual attestation is what gives
 * either party the chance to refuse terms they disagree with.
 */
function standingOfferConditions(rounds: readonly Round[], acceptingParty: PartyId): string[] {
  for (let i = rounds.length - 1; i >= 0; i -= 1) {
    const round = rounds[i];
    if (round === undefined || round.callee === acceptingParty) continue;
    const offer = round.offer;
    if (offer !== undefined && (offer.kind === "open" || offer.kind === "counter")) {
      return [...offer.conditions];
    }
  }
  return [];
}

/** Merge condition lists preserving order, dropping case-insensitive duplicates. */
function mergeConditions(standing: readonly string[], accepted: readonly string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const condition of [...standing, ...accepted]) {
    const key = condition.trim().toLowerCase();
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    merged.push(condition);
  }
  return merged;
}

function expiresAtMs(rec: CaseRecord): number {
  return Date.parse(rec.createdAt) + rec.policy.ttlHours * 3_600_000;
}

// ---------- createCase ----------

export function createCase(
  input: CreateCaseInput,
  now: string = new Date().toISOString(),
): CaseRecord {
  const { caseId, dispute, policy } = input;
  if (typeof caseId !== "string" || caseId.length === 0) {
    throw new Error("createCase: caseId must be a non-empty string");
  }
  if (!Number.isInteger(dispute.amountCents) || dispute.amountCents <= 0) {
    throw new Error("createCase: dispute.amountCents must be a positive integer");
  }
  const a = input.parties.find((p) => p.id === "A");
  const b = input.parties.find((p) => p.id === "B");
  if (a === undefined || b === undefined) {
    throw new Error('createCase: parties must contain exactly one "A" and one "B"');
  }
  if (!Number.isInteger(policy.maxRounds) || policy.maxRounds < 1) {
    throw new Error("createCase: policy.maxRounds must be an integer >= 1");
  }
  if (!(policy.ttlHours > 0)) {
    throw new Error("createCase: policy.ttlHours must be positive");
  }
  if (Number.isNaN(Date.parse(now))) {
    throw new Error(`createCase: invalid timestamp "${now}"`);
  }
  return {
    caseId,
    state: "created",
    dispute,
    parties: [a, b],
    rounds: [],
    epoch: 0,
    policy,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * The ledger genesis draft for a freshly created case. Its payload carries
 * everything {@link rehydrate} needs to rebuild the record from entry #1.
 */
export function genesisEvent(rec: CaseRecord): LedgerEventDraft {
  return {
    type: "case_created",
    payload: {
      caseId: rec.caseId,
      dispute: rec.dispute,
      parties: rec.parties,
      policy: rec.policy,
      createdAt: rec.createdAt,
    },
  };
}

// ---------- Structured call-result schemas (lenient: unknown keys stripped) ----------

const consentResultSchema = z.object({
  consent: z.enum(["yes", "no", "unknown"]),
});

const offerResultSchema = z.object({
  offer_kind: z.enum(["open", "counter", "accept", "reject", "no_response", "unknown"]),
  amount_dollars: z.number().nullish(),
  conditions: z.array(z.string()).nullish(),
  public_rationale: z.string().nullish(),
});

const attestationResultSchema = z.object({
  phrase_spoken: z.string(),
});

// ---------- Ledger payload builders ----------

function roundPayload(round: Round): Record<string, unknown> {
  return { round };
}

function settlementProposedPayload(s: Settlement): Record<string, unknown> {
  return {
    settlement: {
      amountCents: s.amountCents,
      conditions: s.conditions,
      termsDigest: s.termsDigest,
      attestationPhrase: s.attestationPhrase,
    },
  };
}

function impassePayload(reason: string, roundsCompleted: number): Record<string, unknown> {
  return { reason, roundsCompleted };
}

// ---------- transition ----------

interface CaseChanges {
  state?: CaseState;
  rounds?: Round[];
  settlement?: Settlement;
}

export function makeTransition(deps: TransitionDeps): Transition {
  const { computeSettlement, assessImpasse } = deps;
  const verifySpoken =
    deps.verifySpoken ?? ((expected: string, spoken: string) => normalizePhrase(spoken) === normalizePhrase(expected));

  const noop = (rec: CaseRecord): TransitionResult => ({ next: rec, ledgerEvents: [] });

  /** Accepted transition: epoch bump + updatedAt stamp. */
  const commit = (
    rec: CaseRecord,
    now: string,
    changes: CaseChanges,
    ledgerEvents: LedgerEventDraft[],
  ): TransitionResult => ({
    next: { ...rec, ...changes, epoch: rec.epoch + 1, updatedAt: now },
    ledgerEvents,
  });

  const buildSettlement = (terms: SettlementTerms): Settlement => {
    const { termsDigest, attestationPhrase } = computeSettlement(terms);
    return { ...terms, termsDigest, attestationPhrase, attestations: {} };
  };

  function handleConsent(
    rec: CaseRecord,
    ev: Extract<CaseEvent, { kind: "consent_result" }>,
    now: string,
  ): TransitionResult {
    const expected: PartyId | null =
      rec.state === "consent_pending_a" ? "A" : rec.state === "consent_pending_b" ? "B" : null;
    if (expected === null || ev.party !== expected) return noop(rec);
    if (ev.result.outcome !== "completed" || ev.result.structured === null) return noop(rec);
    const parsed = consentResultSchema.safeParse(ev.result.structured);
    if (!parsed.success || parsed.data.consent === "unknown") return noop(rec); // retry is the caller's job
    if (parsed.data.consent === "no") {
      return commit(rec, now, { state: "declined_consent" }, [
        { type: "consent_declined", payload: { party: ev.party, callId: ev.result.callId } },
      ]);
    }
    return commit(
      rec,
      now,
      { state: ev.party === "A" ? "consent_pending_b" : "rounds_active" },
      [
        {
          type: "consent_recorded",
          payload: { party: ev.party, callId: ev.result.callId, consent: "yes" },
        },
      ],
    );
  }

  function handleRound(
    rec: CaseRecord,
    ev: Extract<CaseEvent, { kind: "round_result" }>,
    now: string,
  ): TransitionResult {
    if (rec.state !== "rounds_active") return noop(rec);
    const expectedRound = rec.rounds.length + 1;
    if (ev.round !== expectedRound) return noop(rec); // stale (re-delivery) or out-of-order

    const callee = calleeForRound(ev.round);
    const result = ev.result;
    // Rejected attempt: record unchanged (no epoch bump), audit trail only.
    const fail = (reason: string): TransitionResult => ({
      next: rec,
      ledgerEvents: [
        {
          type: "round_failed",
          payload: { round: ev.round, callee, callId: result.callId, outcome: result.outcome, reason },
        },
      ],
    });

    if (result.outcome !== "completed") return fail(`call_outcome_${result.outcome}`);
    if (result.structured === null) return fail("no_structured_result");
    const parsed = offerResultSchema.safeParse(result.structured);
    if (!parsed.success) return fail("unparseable_offer");
    const kind = parsed.data.offer_kind;
    if (kind === "unknown") return fail("offer_kind_unknown");

    let amountCents: number | undefined;
    if (kind === "open" || kind === "counter" || kind === "accept") {
      const dollars = parsed.data.amount_dollars;
      if (dollars === null || dollars === undefined) {
        // An accept without a restated amount accepts the standing offer.
        if (kind !== "accept") return fail("missing_amount");
        amountCents = latestOfferAmountCents(rec.rounds);
        if (amountCents === undefined) return fail("accept_without_standing_offer");
      } else {
        const cents = dollarsToCents(dollars);
        if (cents === null) return fail("sub_cent_amount");
        if (cents < 0 || cents > rec.dispute.amountCents) return fail("amount_out_of_bounds");
        amountCents = cents;
      }
    }

    const conditions = parsed.data.conditions ?? [];
    const offer: Offer = {
      kind,
      conditions,
      evidence: result.evidence,
      ...(amountCents !== undefined ? { amountCents } : {}),
      ...(parsed.data.public_rationale != null
        ? { publicRationale: parsed.data.public_rationale }
        : {}),
    };
    const round: Round = {
      n: ev.round,
      callee,
      callId: result.callId,
      offer,
      outcome: "completed",
      startedAt: now,
      completedAt: now,
    };
    const rounds = [...rec.rounds, round];

    if (kind === "accept") {
      // The extracted amount is what the party actually said on the call
      // (evidence-backed); the dual attestation of the digest-derived phrase
      // is the safety net that both parties confirm the same terms.
      const settlementConditions = mergeConditions(
        standingOfferConditions(rec.rounds, callee),
        conditions,
      );
      const settlement = buildSettlement({
        amountCents: amountCents as number,
        conditions: settlementConditions,
      });
      return commit(rec, now, { state: "attestation_pending_a", rounds, settlement }, [
        { type: "offer_recorded", payload: roundPayload(round) },
        { type: "settlement_proposed", payload: settlementProposedPayload(settlement) },
      ]);
    }

    const ledgerEvents: LedgerEventDraft[] = [
      { type: "offer_recorded", payload: roundPayload(round) },
    ];
    let state: CaseState = "rounds_active";
    if (rounds.length >= rec.policy.maxRounds) {
      state = "impasse";
      ledgerEvents.push({
        type: "case_impasse",
        payload: impassePayload("max_rounds_exhausted", rounds.length),
      });
    } else if (assessImpasse !== undefined) {
      const verdict = assessImpasse({ ...rec, rounds, epoch: rec.epoch + 1, updatedAt: now });
      if (verdict.impasse) {
        state = "impasse";
        ledgerEvents.push({
          type: "case_impasse",
          payload: impassePayload(verdict.impasseReason ?? "engine_impasse", rounds.length),
        });
      }
    }
    return commit(rec, now, { state, rounds }, ledgerEvents);
  }

  function handleAttestation(
    rec: CaseRecord,
    ev: Extract<CaseEvent, { kind: "attestation_result" }>,
    now: string,
  ): TransitionResult {
    const expected: PartyId | null =
      rec.state === "attestation_pending_a"
        ? "A"
        : rec.state === "attestation_pending_b"
          ? "B"
          : null;
    if (expected === null || ev.party !== expected) return noop(rec);
    const settlement = rec.settlement;
    if (settlement === undefined) return noop(rec); // unreachable in a well-formed record
    if (settlement.attestations[ev.party]?.verified) return noop(rec); // double delivery
    if (ev.result.outcome !== "completed" || ev.result.structured === null) return noop(rec);
    const parsed = attestationResultSchema.safeParse(ev.result.structured);
    if (!parsed.success) return noop(rec);
    const spoken = parsed.data.phrase_spoken;
    if (!verifySpoken(settlement.attestationPhrase, spoken)) {
      return noop(rec); // read-back mismatch: stays pending, caller re-attempts
    }

    const attestation: Attestation = {
      callId: ev.result.callId,
      spokenPhrase: spoken,
      verified: true,
      at: now,
    };
    const nextSettlement: Settlement = {
      ...settlement,
      attestations: { ...settlement.attestations, [ev.party]: attestation },
    };
    const ledgerEvents: LedgerEventDraft[] = [
      { type: "attestation_recorded", payload: { party: ev.party, attestation } },
    ];
    if (ev.party === "A") {
      return commit(rec, now, { state: "attestation_pending_b", settlement: nextSettlement }, ledgerEvents);
    }
    ledgerEvents.push({
      type: "case_settled",
      payload: { amountCents: settlement.amountCents, termsDigest: settlement.termsDigest },
    });
    return commit(rec, now, { state: "settled", settlement: nextSettlement }, ledgerEvents);
  }

  function handleTick(
    rec: CaseRecord,
    ev: Extract<CaseEvent, { kind: "tick" }>,
  ): TransitionResult {
    const now = ev.now; // the tick's clock is authoritative for time-based transitions
    if (isTerminal(rec.state)) return noop(rec);
    if (Date.parse(now) >= expiresAtMs(rec)) {
      return commit(rec, now, { state: "expired" }, [
        { type: "case_expired", payload: { ttlHours: rec.policy.ttlHours, expiredAt: now } },
      ]);
    }
    if (rec.state === "created") {
      // The one ledger-silent transition (no LedgerEventType models "outreach
      // started"); a rehydrated record re-derives it from the resume tick.
      return commit(rec, now, { state: "consent_pending_a" }, []);
    }
    if (rec.state === "rounds_active") {
      const last = rec.rounds[rec.rounds.length - 1];
      // Heal a torn accept (offer_recorded persisted, settlement_proposed lost).
      if (
        last?.offer?.kind === "accept" &&
        last.offer.amountCents !== undefined &&
        rec.settlement === undefined
      ) {
        const settlement = buildSettlement({
          amountCents: last.offer.amountCents,
          // Same merge as the live accept path, or a torn append would settle
          // on different terms (and a different attestation phrase) than the
          // uninterrupted run produced.
          conditions: mergeConditions(
            standingOfferConditions(rec.rounds, last.callee),
            last.offer.conditions,
          ),
        });
        return commit(rec, now, { state: "attestation_pending_a", settlement }, [
          { type: "settlement_proposed", payload: settlementProposedPayload(settlement) },
        ]);
      }
      if (rec.rounds.length >= rec.policy.maxRounds && last?.offer?.kind !== "accept") {
        return commit(rec, now, { state: "impasse" }, [
          {
            type: "case_impasse",
            payload: impassePayload("max_rounds_exhausted", rec.rounds.length),
          },
        ]);
      }
      const verdict = assessImpasse?.(rec);
      if (verdict?.impasse) {
        return commit(rec, now, { state: "impasse" }, [
          {
            type: "case_impasse",
            payload: impassePayload(verdict.impasseReason ?? "engine_impasse", rec.rounds.length),
          },
        ]);
      }
    }
    return noop(rec);
  }

  return function transition(rec, ev, now) {
    switch (ev.kind) {
      case "consent_result":
        return handleConsent(rec, ev, now);
      case "round_result":
        return handleRound(rec, ev, now);
      case "attestation_result":
        return handleAttestation(rec, ev, now);
      case "cancel":
        if (isTerminal(rec.state)) return noop(rec);
        return commit(rec, now, { state: "cancelled" }, [
          { type: "case_cancelled", payload: { reason: ev.reason } },
        ]);
      case "tick":
        return handleTick(rec, ev);
    }
  };
}

// ---------- rehydrate ----------

const partyIdSchema = z.enum(["A", "B"]);

const genesisPayloadSchema = z.object({
  caseId: z.string().min(1),
  dispute: z.object({
    vertical: z.string(),
    summary: z.string(),
    amountCents: z.number().int().positive(),
    currency: z.literal("USD"),
  }),
  parties: z.tuple([
    z.object({
      id: partyIdSchema,
      label: z.string(),
      phone: z.string(),
      private: z.record(z.string(), z.unknown()),
    }),
    z.object({
      id: partyIdSchema,
      label: z.string(),
      phone: z.string(),
      private: z.record(z.string(), z.unknown()),
    }),
  ]),
  policy: z.object({
    maxRounds: z.number().int().min(1),
    coolingOffMinutes: z.number(),
    callWindow: z.object({
      startHour: z.number(),
      endHour: z.number(),
      timezone: z.string(),
    }),
    retryDelaysMinutes: z.array(z.number()),
    ttlHours: z.number().positive(),
  }),
  createdAt: z.string(),
});

const foldConsentPayloadSchema = z.object({ party: partyIdSchema });

const foldRoundPayloadSchema = z.object({
  round: z.object({
    n: z.number().int().min(1),
    callee: partyIdSchema,
    callId: z.string().optional(),
    offer: z
      .object({
        kind: z.enum(["open", "counter", "accept", "reject", "no_response"]),
        amountCents: z.number().int().nonnegative().optional(),
        conditions: z.array(z.string()),
        publicRationale: z.string().optional(),
        evidence: z.array(z.string()),
      })
      .optional(),
    outcome: z.enum(["completed", "no_answer", "declined", "timed_out", "failed", "pending"]),
    startedAt: z.string(),
    completedAt: z.string().optional(),
  }),
});

const foldSettlementPayloadSchema = z.object({
  settlement: z.object({
    amountCents: z.number().int().nonnegative(),
    conditions: z.array(z.string()),
    termsDigest: z.string(),
    attestationPhrase: z.string(),
  }),
});

const foldAttestationPayloadSchema = z.object({
  party: partyIdSchema,
  attestation: z.object({
    callId: z.string(),
    spokenPhrase: z.string(),
    verified: z.boolean(),
    at: z.string(),
  }),
});

function applyEntry(rec: CaseRecord, e: LedgerEntry): CaseRecord {
  const stamp = (changes: CaseChanges): CaseRecord => ({
    ...rec,
    ...changes,
    epoch: Math.max(rec.epoch, e.epoch),
    updatedAt: e.at,
  });

  switch (e.type) {
    case "case_created":
      throw new Error(`rehydrate: duplicate case_created for ${rec.caseId} at seq ${e.seq}`);

    case "consent_recorded": {
      const { party } = foldConsentPayloadSchema.parse(e.payload);
      return stamp({ state: party === "A" ? "consent_pending_b" : "rounds_active" });
    }

    case "consent_declined":
      return stamp({ state: "declined_consent" });

    case "round_started":
    case "round_failed":
      return rec; // audit-only entries: the live transition was a no-op too

    case "offer_recorded": {
      const round = foldRoundPayloadSchema.parse(e.payload).round as unknown as Round;
      if (round.n !== rec.rounds.length + 1) {
        throw new Error(
          `rehydrate: ledger records round ${round.n} after ${rec.rounds.length} rounds (seq ${e.seq})`,
        );
      }
      const rounds = [...rec.rounds, round];
      // Mirror the live transition when its case_impasse companion entry was
      // lost to a torn append: max-rounds exhaustion is derivable.
      const state: CaseState =
        rec.state === "rounds_active" &&
        round.offer?.kind !== "accept" &&
        rounds.length >= rec.policy.maxRounds
          ? "impasse"
          : rec.state;
      return stamp({ rounds, state });
    }

    case "settlement_proposed": {
      const { settlement } = foldSettlementPayloadSchema.parse(e.payload);
      return stamp({
        state: "attestation_pending_a",
        settlement: { ...settlement, attestations: {} },
      });
    }

    case "attestation_recorded": {
      const { party, attestation } = foldAttestationPayloadSchema.parse(e.payload);
      const settlement = rec.settlement;
      if (settlement === undefined) {
        throw new Error(`rehydrate: attestation before settlement_proposed (seq ${e.seq})`);
      }
      const attestations = { ...settlement.attestations, [party]: attestation };
      const bothVerified = attestations.A?.verified === true && attestations.B?.verified === true;
      return stamp({
        state: bothVerified ? "settled" : "attestation_pending_b",
        settlement: { ...settlement, attestations },
      });
    }

    case "case_settled":
      return stamp({ state: "settled" });
    case "case_impasse":
      return stamp({ state: "impasse" });
    case "case_cancelled":
      return stamp({ state: "cancelled" });
    case "case_expired":
      return stamp({ state: "expired" });
  }
}

/**
 * Rebuilds a CaseRecord purely from its ledger entries (crash-resume).
 * Entries of other cases are ignored; order is by `seq`. Throws on a ledger
 * that is structurally corrupt (no genesis, impossible round numbering) —
 * corruption must be loud, never guessed around.
 */
export function rehydrate(caseId: string, ledgerEntries: readonly LedgerEntry[]): CaseRecord {
  const entries = ledgerEntries
    .filter((e) => e.caseId === caseId)
    .slice()
    .sort((x, y) => x.seq - y.seq);
  const first = entries[0];
  if (first === undefined) {
    throw new Error(`rehydrate: no ledger entries for case ${caseId}`);
  }
  if (first.type !== "case_created") {
    throw new Error(`rehydrate: ledger for ${caseId} does not begin with case_created`);
  }
  const genesis = genesisPayloadSchema.parse(first.payload);
  if (genesis.caseId !== caseId) {
    throw new Error(
      `rehydrate: genesis payload caseId "${genesis.caseId}" does not match "${caseId}"`,
    );
  }
  let rec = createCase(genesis as unknown as CreateCaseInput, genesis.createdAt);
  rec = { ...rec, epoch: Math.max(rec.epoch, first.epoch) };
  for (const entry of entries.slice(1)) {
    rec = applyEntry(rec, entry);
  }
  return rec;
}
