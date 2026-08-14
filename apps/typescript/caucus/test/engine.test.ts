import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { assess, extractCurve } from "../src/engine.js";
import type {
  CaseRecord,
  CaseState,
  OfferKind,
  PartyId,
  Round,
  Settlement,
} from "../src/types.js";

// ---------- Fixtures (fictional +1555 numbers only) ----------

interface RoundOffer {
  kind: OfferKind;
  amountCents?: number;
  conditions?: string[];
  evidence?: string[];
}

function makeRound(n: number, callee: PartyId, offer?: RoundOffer): Round {
  const base: Round = {
    n,
    callee,
    outcome: "completed",
    startedAt: `2026-07-29T0${n % 10}:00:00.000Z`,
    completedAt: `2026-07-29T0${n % 10}:10:00.000Z`,
  };
  if (offer === undefined) return base;
  return {
    ...base,
    offer: {
      kind: offer.kind,
      conditions: offer.conditions ?? [],
      evidence: offer.evidence ?? [],
      ...(offer.amountCents !== undefined
        ? { amountCents: offer.amountCents }
        : {}),
    },
  };
}

function makeCase(opts: {
  rounds?: Round[];
  maxRounds?: number;
  state?: CaseState;
  settlement?: Settlement;
  aReservationCents?: number;
  bReservationCents?: number;
  amountCents?: number;
}): CaseRecord {
  return {
    caseId: "cs_test_0001",
    state: opts.state ?? "rounds_active",
    dispute: {
      vertical: "security_deposit",
      summary: "Disagreement over how much of a $1,200 deposit is returned.",
      amountCents: opts.amountCents ?? 120_000,
      currency: "USD",
    },
    parties: [
      {
        id: "A",
        label: "Tenant Alex",
        phone: "+15550000001",
        private:
          opts.aReservationCents !== undefined
            ? { reservationCents: opts.aReservationCents }
            : {},
      },
      {
        id: "B",
        label: "Landlord Sam",
        phone: "+15550000002",
        private:
          opts.bReservationCents !== undefined
            ? { reservationCents: opts.bReservationCents }
            : {},
      },
    ],
    rounds: opts.rounds ?? [],
    epoch: (opts.rounds ?? []).length,
    ...(opts.settlement !== undefined ? { settlement: opts.settlement } : {}),
    policy: {
      maxRounds: opts.maxRounds ?? 8,
      coolingOffMinutes: 0,
      callWindow: { startHour: 9, endHour: 20, timezone: "America/New_York" },
      retryDelaysMinutes: [],
      ttlHours: 72,
    },
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T09:00:00.000Z",
  };
}

// ---------- Curve ----------

describe("extractCurve", () => {
  it("emits one point per monetary offer, attributed to the round's callee", () => {
    const curve = extractCurve([
      makeRound(1, "A", { kind: "open", amountCents: 100_000 }),
      makeRound(2, "B"), // no_answer round — no offer
      makeRound(3, "B", { kind: "counter", amountCents: 50_000 }),
      makeRound(4, "A", { kind: "reject" }), // offer without amount
    ]);
    expect(curve).toEqual([
      { round: 1, party: "A", amountCents: 100_000 },
      { round: 3, party: "B", amountCents: 50_000 },
    ]);
  });

  it("orders points by round number even when input rounds are unsorted", () => {
    const curve = extractCurve([
      makeRound(3, "A", { kind: "counter", amountCents: 90_000 }),
      makeRound(1, "A", { kind: "open", amountCents: 100_000 }),
      makeRound(2, "B", { kind: "counter", amountCents: 50_000 }),
    ]);
    expect(curve.map((c) => c.round)).toEqual([1, 2, 3]);
  });
});

// ---------- ZOPA ----------

describe("zopa estimation", () => {
  it("reports [A.min, B.max] when both bounds exist and overlap", () => {
    const rec = makeCase({ aReservationCents: 70_000, bReservationCents: 90_000 });
    expect(assess(rec).zopa).toEqual({ lowCents: 70_000, highCents: 90_000 });
  });

  it("is undefined when the intersection is empty", () => {
    const rec = makeCase({ aReservationCents: 90_000, bReservationCents: 70_000 });
    expect(assess(rec).zopa).toBeUndefined();
  });

  it("is undefined when either bound is absent", () => {
    expect(assess(makeCase({ aReservationCents: 70_000 })).zopa).toBeUndefined();
    expect(assess(makeCase({ bReservationCents: 90_000 })).zopa).toBeUndefined();
    expect(assess(makeCase({})).zopa).toBeUndefined();
  });
});

// ---------- Impasse ----------

describe("impasse detection", () => {
  it("flags a stall when a party repeats within 2% and the other side has not moved", () => {
    const rec = makeCase({
      rounds: [
        makeRound(1, "A", { kind: "open", amountCents: 100_000 }),
        makeRound(2, "B", { kind: "counter", amountCents: 50_000 }),
        makeRound(3, "A", { kind: "counter", amountCents: 99_000 }), // 1% shift
        makeRound(4, "B", { kind: "counter", amountCents: 50_000 }),
      ],
    });
    const a = assess(rec);
    expect(a.impasse).toBe(true);
    expect(a.impasseReason).toMatch(/^stall:/);
  });

  it("does not flag a stall when the other side is still moving", () => {
    const rec = makeCase({
      rounds: [
        makeRound(1, "A", { kind: "open", amountCents: 100_000 }),
        makeRound(2, "B", { kind: "counter", amountCents: 50_000 }),
        makeRound(3, "A", { kind: "counter", amountCents: 99_000 }), // repeat...
        makeRound(4, "B", { kind: "counter", amountCents: 60_000 }), // ...but B moved 20%
      ],
    });
    const a = assess(rec);
    expect(a.impasse).toBe(false);
    expect(a.impasseReason).toBeUndefined();
  });

  it("flags oscillation when a party reverses concession direction", () => {
    const rec = makeCase({
      rounds: [
        makeRound(1, "A", { kind: "open", amountCents: 100_000 }),
        makeRound(2, "B", { kind: "counter", amountCents: 50_000 }),
        makeRound(3, "A", { kind: "counter", amountCents: 90_000 }),
        makeRound(4, "B", { kind: "counter", amountCents: 60_000 }),
        makeRound(5, "A", { kind: "counter", amountCents: 85_000 }),
        makeRound(6, "B", { kind: "counter", amountCents: 55_000 }), // B walks back
      ],
    });
    const a = assess(rec);
    expect(a.impasse).toBe(true);
    expect(a.impasseReason).toMatch(/^oscillation: party B/);
  });

  it("flags max_rounds when the round limit is reached without agreement", () => {
    const rec = makeCase({
      maxRounds: 2,
      rounds: [
        makeRound(1, "A", { kind: "open", amountCents: 100_000 }),
        makeRound(2, "B", { kind: "counter", amountCents: 50_000 }),
      ],
    });
    const a = assess(rec);
    expect(a.impasse).toBe(true);
    expect(a.impasseReason).toMatch(/^max_rounds:/);
  });

  it("a converging case that ends in acceptance is never an impasse", () => {
    const rec = makeCase({
      state: "settled",
      maxRounds: 6, // limit reached — accept still wins
      rounds: [
        makeRound(1, "A", { kind: "open", amountCents: 100_000 }),
        makeRound(2, "B", { kind: "counter", amountCents: 60_000 }),
        makeRound(3, "A", { kind: "counter", amountCents: 80_000 }),
        makeRound(4, "B", { kind: "counter", amountCents: 70_000 }),
        makeRound(5, "A", { kind: "counter", amountCents: 75_000 }),
        makeRound(6, "B", { kind: "accept", amountCents: 75_000 }),
      ],
    });
    const a = assess(rec);
    expect(a.impasse).toBe(false);
    expect(a.impasseReason).toBeUndefined();
    expect(a.curve).toHaveLength(6);
  });

  it("impasse reasons never contain reservation-derived (ZOPA) figures", () => {
    const rec = makeCase({
      aReservationCents: 71_137, // sentinel values that appear nowhere else
      bReservationCents: 98_251,
      rounds: [
        makeRound(1, "A", { kind: "open", amountCents: 100_000 }),
        makeRound(2, "B", { kind: "counter", amountCents: 50_000 }),
        makeRound(3, "A", { kind: "counter", amountCents: 99_500 }),
        makeRound(4, "B", { kind: "counter", amountCents: 50_000 }),
      ],
    });
    const a = assess(rec);
    expect(a.impasse).toBe(true);
    expect(a.zopa).toEqual({ lowCents: 71_137, highCents: 98_251 });
    expect(a.impasseReason).not.toMatch(/71137|98251|711\.37|982\.51/);
  });
});

// ---------- Next suggestion ----------

describe("nextSuggestionCents", () => {
  it("is the whole-dollar midpoint of the latest opposing offers", () => {
    const rec = makeCase({
      rounds: [
        makeRound(1, "A", { kind: "open", amountCents: 110_000 }),
        makeRound(2, "B", { kind: "counter", amountCents: 60_000 }),
        makeRound(3, "A", { kind: "counter", amountCents: 100_000 }),
        makeRound(4, "B", { kind: "counter", amountCents: 80_000 }),
      ],
    });
    expect(assess(rec).nextSuggestionCents).toBe(90_000);
  });

  it("rounds to whole dollars", () => {
    const rec = makeCase({
      rounds: [
        makeRound(1, "A", { kind: "open", amountCents: 100_000 }),
        makeRound(2, "B", { kind: "counter", amountCents: 90_100 }),
      ],
    });
    // midpoint 95_050 → $950.50 → rounds to $951
    expect(assess(rec).nextSuggestionCents).toBe(95_100);
  });

  it("is undefined while the gap exceeds 40% of the disputed amount", () => {
    const rec = makeCase({
      amountCents: 120_000,
      rounds: [
        makeRound(1, "A", { kind: "open", amountCents: 110_000 }),
        makeRound(2, "B", { kind: "counter", amountCents: 60_000 }), // gap 50k > 48k
      ],
    });
    expect(assess(rec).nextSuggestionCents).toBeUndefined();
  });

  it("is undefined until both parties have made a monetary offer", () => {
    const rec = makeCase({
      rounds: [makeRound(1, "A", { kind: "open", amountCents: 100_000 })],
    });
    expect(assess(rec).nextSuggestionCents).toBeUndefined();
  });

  it("is undefined when the latest offers already agree", () => {
    const rec = makeCase({
      rounds: [
        makeRound(1, "A", { kind: "open", amountCents: 80_000 }),
        makeRound(2, "B", { kind: "counter", amountCents: 80_000 }),
      ],
    });
    expect(assess(rec).nextSuggestionCents).toBeUndefined();
  });

  it("is undefined when rounding would land on an endpoint (sub-$2 gap)", () => {
    const rec = makeCase({
      rounds: [
        makeRound(1, "A", { kind: "open", amountCents: 100_000 }),
        makeRound(2, "B", { kind: "counter", amountCents: 100_050 }),
      ],
    });
    expect(assess(rec).nextSuggestionCents).toBeUndefined();
  });

  it("property: whenever defined, the suggestion lies strictly between the latest offers", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10_000, max: 5_000_000 }),
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.integer({ min: 0, max: 5_000_000 }),
        (amountCents, rawA, rawB) => {
          const a = Math.min(rawA, amountCents);
          const b = Math.min(rawB, amountCents);
          const rec = makeCase({
            amountCents,
            rounds: [
              makeRound(1, "A", { kind: "open", amountCents: a }),
              makeRound(2, "B", { kind: "counter", amountCents: b }),
            ],
          });
          const suggestion = assess(rec).nextSuggestionCents;
          const low = Math.min(a, b);
          const high = Math.max(a, b);
          const gap = high - low;

          if (suggestion !== undefined) {
            expect(suggestion).toBeGreaterThan(low);
            expect(suggestion).toBeLessThan(high);
            expect(suggestion % 100).toBe(0); // whole dollars
            expect(gap).toBeLessThanOrEqual(0.4 * amountCents);
          }
          // A workable gap (≥ $2, within the ratio cap) always yields a suggestion.
          if (gap >= 200 && gap <= 0.4 * amountCents) {
            expect(suggestion).toBeDefined();
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
