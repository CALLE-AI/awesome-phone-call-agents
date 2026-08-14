/**
 * Negotiation analytics engine.
 *
 * Pure functions over a `CaseRecord`: concession-curve extraction, ZOPA
 * estimation from system-side reservation bounds, impasse detection, and a
 * neutral midpoint suggestion for the next shuttle round.
 *
 * NEUTRALITY / TAINT NOTE: the ZOPA is computed from each party's PRIVATE
 * reservation bound. It is returned only as structured data on the
 * assessment object for system-side decision making. Nothing in this module
 * embeds reservation or ZOPA numbers into any string (impasse reasons are
 * deliberately number-free for offer amounts' sake as well) — keeping private
 * figures out of call scripts is enforced by the renderer's taint checks, but
 * we avoid producing leakable strings here in the first place.
 */

import type {
  CaseRecord,
  CurvePoint,
  EngineAssessment,
  PartyId,
  Round,
} from "./types.js";

/** Two offers within this relative tolerance are treated as "the same amount". */
export const STALL_TOLERANCE = 0.02;

/** A midpoint is only suggested when the parties' gap is at most this share of the disputed amount. */
export const SUGGESTION_MAX_GAP_RATIO = 0.4;

const CENTS_PER_DOLLAR = 100;

/** True when `b` is within STALL_TOLERANCE of `a` (relative to `a`; exact match required when `a` is 0). */
function sameAmount(a: number, b: number): boolean {
  if (a === 0) return b === 0;
  return Math.abs(b - a) <= STALL_TOLERANCE * Math.abs(a);
}

/**
 * Concession curve: one point per recorded monetary offer, in round order.
 * The offering party is the round's callee — shuttle rounds capture the
 * callee's response, so any offer recorded on a round was made by them.
 */
export function extractCurve(rounds: readonly Round[]): CurvePoint[] {
  return [...rounds]
    .sort((a, b) => a.n - b.n)
    .filter(
      (r): r is Round & { offer: { amountCents: number } } =>
        typeof r.offer?.amountCents === "number",
    )
    .map((r) => ({
      round: r.n,
      party: r.callee,
      amountCents: r.offer.amountCents,
    }));
}

/**
 * Zone of possible agreement from disclosed-to-the-system reservation bounds:
 * party A's bound is their minimum acceptable, party B's their maximum.
 * Undefined when either bound is absent or the intersection is empty.
 */
function estimateZopa(
  rec: CaseRecord,
): { lowCents: number; highCents: number } | undefined {
  const a = rec.parties.find((p) => p.id === "A")?.private.reservationCents;
  const b = rec.parties.find((p) => p.id === "B")?.private.reservationCents;
  if (typeof a !== "number" || typeof b !== "number") return undefined;
  if (a > b) return undefined; // empty intersection — no overlap to report
  return { lowCents: a, highCents: b };
}

/**
 * A case that has produced an acceptance (or already carries a settlement)
 * can never be an impasse, regardless of what the curve looks like — an
 * accept necessarily mirrors the opposing offer and must not be mistaken
 * for a stall or reversal.
 */
function hasSettlementSignal(rec: CaseRecord): boolean {
  if (rec.settlement !== undefined) return true;
  if (
    rec.state === "settled" ||
    rec.state === "attestation_pending_a" ||
    rec.state === "attestation_pending_b"
  ) {
    return true;
  }
  return rec.rounds.some((r) => r.offer?.kind === "accept");
}

function pointsFor(curve: readonly CurvePoint[], party: PartyId): CurvePoint[] {
  return curve.filter((c) => c.party === party);
}

/**
 * Stall: a party's two latest consecutive offers are the same amount (within
 * STALL_TOLERANCE) while the other side has shown no movement of its own —
 * i.e. the other side's latest two offers are also the same, or it has not
 * yet made a second offer that could count as movement.
 */
function detectStall(curve: readonly CurvePoint[]): string | undefined {
  for (const party of ["A", "B"] as const) {
    const mine = pointsFor(curve, party);
    if (mine.length < 2) continue;
    const prev = mine[mine.length - 2];
    const last = mine[mine.length - 1];
    if (prev === undefined || last === undefined) continue;
    if (!sameAmount(prev.amountCents, last.amountCents)) continue;

    const other: PartyId = party === "A" ? "B" : "A";
    const theirs = pointsFor(curve, other);
    const otherMoved =
      theirs.length >= 2 &&
      !sameAmount(
        theirs[theirs.length - 2]!.amountCents,
        theirs[theirs.length - 1]!.amountCents,
      );
    if (!otherMoved) {
      return `stall: party ${party} repeated their position in consecutive offers while party ${other} did not move`;
    }
  }
  return undefined;
}

/**
 * Oscillation: a party reverses concession direction — after moving one way
 * they move back the other way. Movements within STALL_TOLERANCE are treated
 * as jitter, not direction changes.
 */
function detectOscillation(curve: readonly CurvePoint[]): string | undefined {
  for (const party of ["A", "B"] as const) {
    const amounts = pointsFor(curve, party).map((c) => c.amountCents);
    let lastDirection = 0;
    for (let i = 1; i < amounts.length; i++) {
      const from = amounts[i - 1]!;
      const to = amounts[i]!;
      if (sameAmount(from, to)) continue; // jitter, not movement
      const direction = Math.sign(to - from);
      if (lastDirection !== 0 && direction !== lastDirection) {
        return `oscillation: party ${party} reversed concession direction`;
      }
      lastDirection = direction;
    }
  }
  return undefined;
}

function detectImpasse(
  rec: CaseRecord,
  curve: readonly CurvePoint[],
): string | undefined {
  const stall = detectStall(curve);
  if (stall !== undefined) return stall;
  const oscillation = detectOscillation(curve);
  if (oscillation !== undefined) return oscillation;
  if (rec.rounds.length >= rec.policy.maxRounds) {
    return `max_rounds: round limit of ${rec.policy.maxRounds} reached without agreement`;
  }
  return undefined;
}

/**
 * Neutral midpoint suggestion: midpoint of the two parties' latest offers,
 * rounded to a whole dollar. Only produced when both sides have a live offer,
 * the gap is at most SUGGESTION_MAX_GAP_RATIO of the disputed amount, and the
 * rounded midpoint still lies strictly between the two offers (a sub-$2 gap
 * can round onto an endpoint, which would no longer be a compromise).
 */
function suggestNext(
  rec: CaseRecord,
  curve: readonly CurvePoint[],
): number | undefined {
  const latestOf = (party: PartyId): CurvePoint | undefined => {
    const mine = pointsFor(curve, party);
    return mine[mine.length - 1];
  };
  const a = latestOf("A");
  const b = latestOf("B");
  if (a === undefined || b === undefined) return undefined;

  const gap = Math.abs(a.amountCents - b.amountCents);
  if (gap === 0) return undefined;
  if (gap > SUGGESTION_MAX_GAP_RATIO * rec.dispute.amountCents) return undefined;

  const midpoint =
    Math.round(
      (a.amountCents + b.amountCents) / 2 / CENTS_PER_DOLLAR,
    ) * CENTS_PER_DOLLAR;
  const low = Math.min(a.amountCents, b.amountCents);
  const high = Math.max(a.amountCents, b.amountCents);
  if (midpoint <= low || midpoint >= high) return undefined;
  return midpoint;
}

/** Assess a case: curve, ZOPA, impasse detection, and next-round suggestion. */
export function assess(rec: CaseRecord): EngineAssessment {
  const curve = extractCurve(rec.rounds);
  const assessment: EngineAssessment = { impasse: false, curve };

  const zopa = estimateZopa(rec);
  if (zopa !== undefined) assessment.zopa = zopa;

  if (!hasSettlementSignal(rec)) {
    const reason = detectImpasse(rec, curve);
    if (reason !== undefined) {
      assessment.impasse = true;
      assessment.impasseReason = reason;
    }
  }

  const suggestion = suggestNext(rec, curve);
  if (suggestion !== undefined) assessment.nextSuggestionCents = suggestion;

  return assessment;
}
