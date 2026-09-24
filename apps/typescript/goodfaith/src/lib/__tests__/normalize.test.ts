// File: src/lib/__tests__/normalize.test.ts
import { describe, it, expect } from "vitest";
import { normalizeCallTask, type FairPrices } from "@/lib/normalize";
import type { CallTask, CallRecipient } from "@/lib/calle-types";
import fixture from "../../../data/fixtures/mri-72148.json";
import fair from "../../../data/fair-prices.json";

const FAIR = fair as FairPrices;
const FIXTURE = fixture as unknown as CallTask;

function recipient(over: Partial<CallRecipient>): CallRecipient {
  return {
    name: "Test Clinic",
    phone: "+15120000000",
    status: "completed",
    summary: "test",
    structured_result: null,
    attempts: [],
    ...over,
  };
}

function taskWith(recipients: CallRecipient[], confidence = 0.86): CallTask {
  return {
    id: "call_test",
    status: "completed",
    structured_result: null,
    task_completed: true,
    completion_confidence: { score: confidence, label: "high" },
    recipients,
  };
}

describe("normalizeCallTask — winner and benchmark (F-005, F-006)", () => {
  const n = normalizeCallTask(FIXTURE, FAIR, "72148");

  it("ranks the $438 all-inclusive clinic as the winner", () => {
    const winner = n.results.find((r) => r.ranked);
    expect(winner?.landed_cost).toBe(438);
    expect(n.rollup.lowest_all_inclusive).toBe(438);
  });

  it("computes exactly one ranked, one non-comparable, two no-quote (bucketing)", () => {
    expect(n.results.filter((r) => r.ranked).length).toBe(1);
    expect(n.results.filter((r) => r.status === "non_comparable").length).toBe(1);
    expect(n.results.filter((r) => r.status === "no_quote").length).toBe(2);
  });

  it("computes percent-vs-fair as negative (below fair) for the winner", () => {
    const winner = n.results.find((r) => r.ranked);
    expect(winner?.pct_vs_fair).not.toBeNull();
    expect(winner!.pct_vs_fair!).toBeLessThan(0);
    // (438 - 500) / 500 = -12.4% -> rounded -12
    expect(winner!.pct_vs_fair).toBe(-12);
  });
});

describe("INVARIANT 1 — no ranked row without evidence (F-001)", () => {
  const n = normalizeCallTask(FIXTURE, FAIR, "72148");
  it("every ranked row has a non-empty quoted_verbatim traced to a turn", () => {
    for (const r of n.results.filter((x) => x.ranked)) {
      expect(r.evidence).not.toBeNull();
      expect(r.evidence!.quoted_verbatim.trim().length).toBeGreaterThan(0);
      expect(r.evidence!.offset_seconds).not.toBeNull();
    }
  });
});

describe("INVARIANT 2 — confidence gate fail-closed (F-002)", () => {
  it("a 0.55-confidence quoted result is held back, never ranked", () => {
    const t = taskWith(
      [
        recipient({
          structured_result: {
            quote_given: true,
            cash_price: 400,
            price_basis: "all_inclusive",
            quoted_verbatim: "our cash price is four hundred dollars all inclusive",
            outcome: "quoted",
          },
          attempts: [
            {
              status: "completed",
              transcript_turns: [
                { offset_seconds: 5, speaker: "clinic", text: "our cash price is four hundred dollars all inclusive" },
              ],
            },
          ],
        }),
      ],
      0.55
    );
    const n = normalizeCallTask(t, FAIR, "72148");
    const row = n.results[0];
    expect(row.ranked).toBe(false);
    expect(row.status).toBe("needs_review");
    expect(row.rejection).toBe("LOW_CONFIDENCE");
  });
});

describe("INVARIANT 3 — only comparable quotes ranked (F-003)", () => {
  it("a facility_only quote is flagged NON_COMPARABLE and not ranked, even if cheaper", () => {
    const t = taskWith([
      recipient({
        name: "Facility-only clinic",
        structured_result: {
          quote_given: true,
          cash_price: 300,
          price_basis: "facility_only",
          quoted_verbatim: "the facility fee is three hundred dollars",
          outcome: "quoted",
        },
        attempts: [
          {
            status: "completed",
            transcript_turns: [{ offset_seconds: 3, speaker: "clinic", text: "the facility fee is three hundred dollars" }],
          },
        ],
      }),
    ]);
    const n = normalizeCallTask(t, FAIR, "72148");
    const row = n.results[0];
    expect(row.comparable).toBe(false);
    expect(row.ranked).toBe(false);
    expect(row.rejection).toBe("NON_COMPARABLE");
  });
});

describe("INVARIANT 1 hardening — untraceable verbatim (offset null) is never ranked", () => {
  it("an all-inclusive price whose verbatim matches no transcript turn is NO_EVIDENCE, not ranked", () => {
    const t = taskWith([
      recipient({
        structured_result: {
          quote_given: true,
          cash_price: 420,
          price_basis: "all_inclusive",
          quoted_verbatim: "our cash price is four hundred twenty dollars all inclusive",
          outcome: "quoted",
        },
        // transcript turn does NOT contain the quoted sentence -> offset_seconds resolves to null
        attempts: [
          {
            status: "completed",
            transcript_turns: [{ offset_seconds: 2, speaker: "clinic", text: "thanks for calling, how can I help" }],
          },
        ],
      }),
    ]);
    const n = normalizeCallTask(t, FAIR, "72148");
    const row = n.results[0];
    expect(row.ranked).toBe(false);
    expect(row.status).toBe("non_comparable");
    expect(row.rejection).toBe("NO_EVIDENCE");
  });
});

describe("landedCost sanity floor — price <= 0 is never ranked", () => {
  function tracedRow(cash_price: number): CallTask {
    const verbatim = "our cash price is that amount all inclusive";
    return taskWith([
      recipient({
        structured_result: {
          quote_given: true,
          cash_price,
          price_basis: "all_inclusive",
          quoted_verbatim: verbatim,
          outcome: "quoted",
        },
        attempts: [{ status: "completed", transcript_turns: [{ offset_seconds: 7, speaker: "clinic", text: verbatim }] }],
      }),
    ]);
  }

  it("a zero price is treated as no valid quote and not ranked", () => {
    const n = normalizeCallTask(tracedRow(0), FAIR, "72148");
    const row = n.results[0];
    expect(row.ranked).toBe(false);
    expect(row.landed_cost).toBeNull();
    expect(row.comparable).toBe(false);
  });

  it("a negative price is treated as no valid quote and not ranked", () => {
    const n = normalizeCallTask(tracedRow(-5), FAIR, "72148");
    const row = n.results[0];
    expect(row.ranked).toBe(false);
    expect(row.landed_cost).toBeNull();
    expect(row.comparable).toBe(false);
  });
});

describe("K9 — null structured_result never throws (F-012)", () => {
  it("a null structured_result becomes no_quote without throwing", () => {
    const t = taskWith([recipient({ structured_result: null })]);
    expect(() => normalizeCallTask(t, FAIR, "72148")).not.toThrow();
    const n = normalizeCallTask(t, FAIR, "72148");
    expect(n.results[0].status).toBe("no_quote");
    expect(n.results[0].rejection).toBe("NO_QUOTE");
  });
});
