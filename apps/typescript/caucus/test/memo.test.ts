import { describe, expect, it } from "vitest";

import {
  MEMO_NOTICE,
  formatUsd,
  maskPhone,
  renderMemo,
  writeMemoJson,
} from "../src/memo.js";
import type { CaseRecord, LedgerEntry } from "../src/types.js";

const NOW = "2026-07-30T12:00:00.000Z";

// Sentinels that must NEVER appear in any rendered artifact.
const PRIVATE_NOTE_A = "PRIVATE-NOTE-A-would-take-less";
const PRIVATE_NOTE_B = "PRIVATE-NOTE-B-insurance-covers-it";
const RESERVATION_A = 87_701;
const RESERVATION_B = 96_403;

function settledCase(): CaseRecord {
  return {
    caseId: "cs_memo_0001",
    state: "settled",
    dispute: {
      vertical: "security_deposit",
      summary: "Disagreement over how much of a $1,200 deposit is returned.",
      amountCents: 120_000,
      currency: "USD",
    },
    parties: [
      {
        id: "A",
        label: "Tenant Alex",
        phone: "+15550000001",
        private: { reservationCents: RESERVATION_A, notes: PRIVATE_NOTE_A },
      },
      {
        id: "B",
        label: "Landlord Sam",
        phone: "+15550000002",
        private: { reservationCents: RESERVATION_B, notes: PRIVATE_NOTE_B },
      },
    ],
    rounds: [
      {
        n: 1,
        callee: "A",
        callId: "call_r1",
        offer: {
          kind: "open",
          amountCents: 120_000,
          conditions: ["itemized deduction list provided"],
          evidence: ["I want the full deposit back"],
        },
        outcome: "completed",
        startedAt: "2026-07-29T15:00:00.000Z",
        completedAt: "2026-07-29T15:06:00.000Z",
      },
      {
        n: 2,
        callee: "B",
        callId: "call_r2",
        offer: {
          kind: "counter",
          amountCents: 60_000,
          conditions: [],
          // Pipe character exercises markdown-table escaping.
          evidence: ["the carpet | was damaged in two rooms"],
        },
        outcome: "completed",
        startedAt: "2026-07-29T16:00:00.000Z",
        completedAt: "2026-07-29T16:07:00.000Z",
      },
      {
        n: 3,
        callee: "A",
        callId: "call_r3",
        offer: {
          kind: "counter",
          amountCents: 90_000,
          conditions: ["tenant returns garage remote"],
          evidence: ["nine hundred and the remote back, final"],
        },
        outcome: "completed",
        startedAt: "2026-07-29T17:00:00.000Z",
        completedAt: "2026-07-29T17:05:00.000Z",
      },
      {
        n: 4,
        callee: "B",
        callId: "call_r4",
        offer: {
          kind: "accept",
          amountCents: 90_000,
          conditions: [],
          evidence: ["fine, nine hundred works"],
        },
        outcome: "completed",
        startedAt: "2026-07-29T18:00:00.000Z",
        completedAt: "2026-07-29T18:04:00.000Z",
      },
    ],
    epoch: 9,
    settlement: {
      amountCents: 90_000,
      conditions: ["tenant returns garage remote"],
      termsDigest:
        "d1f2e3a4b5c6d7e8f90112233445566778899aabbccddeeff0011223344556677",
      attestationPhrase: "amber falcon nine",
      attestations: {
        A: {
          callId: "call_att_a",
          spokenPhrase: "amber falcon nine",
          verified: true,
          at: "2026-07-29T19:00:00.000Z",
        },
        B: {
          callId: "call_att_b",
          spokenPhrase: "Amber Falcon Nine",
          verified: true,
          at: "2026-07-29T19:20:00.000Z",
        },
      },
    },
    policy: {
      maxRounds: 8,
      coolingOffMinutes: 0,
      callWindow: { startHour: 9, endHour: 20, timezone: "America/New_York" },
      retryDelaysMinutes: [],
      ttlHours: 72,
    },
    createdAt: "2026-07-29T14:00:00.000Z",
    updatedAt: "2026-07-29T19:30:00.000Z",
  };
}

function ledgerFor(caseId: string): LedgerEntry[] {
  const mk = (seq: number, type: LedgerEntry["type"], hash: string, prevHash: string): LedgerEntry => ({
    seq,
    caseId,
    epoch: seq,
    type,
    payload: {},
    at: `2026-07-29T14:0${seq}:00.000Z`,
    hash,
    prevHash,
  });
  return [
    mk(1, "case_created", "hash_aaa111", "genesis"),
    mk(2, "offer_recorded", "hash_bbb222", "hash_aaa111"),
    mk(3, "case_settled", "hash_ccc333", "hash_bbb222"),
  ];
}

describe("maskPhone / formatUsd", () => {
  it("masks to the last four digits", () => {
    expect(maskPhone("+15550000001")).toBe("***0001");
    expect(maskPhone("+15550000002")).toBe("***0002");
  });

  it("formats cents as fixed-locale USD", () => {
    expect(formatUsd(120_000)).toBe("$1,200.00");
    expect(formatUsd(90_050)).toBe("$900.50");
    expect(formatUsd(5)).toBe("$0.05");
    expect(formatUsd(123_456_789)).toBe("$1,234,567.89");
  });
});

describe("writeMemoJson", () => {
  it("includes every round with offer details, in round order", () => {
    const rec = settledCase();
    const json = writeMemoJson(rec, ledgerFor(rec.caseId), NOW);
    expect(json.rounds).toHaveLength(rec.rounds.length);
    expect(json.rounds.map((r) => r.round)).toEqual([1, 2, 3, 4]);
    expect(json.rounds.map((r) => r.kind)).toEqual([
      "open",
      "counter",
      "counter",
      "accept",
    ]);
    expect(json.rounds.map((r) => r.amountCents)).toEqual([
      120_000, 60_000, 90_000, 90_000,
    ]);
    expect(json.rounds[2]?.conditions).toEqual(["tenant returns garage remote"]);
    expect(json.rounds[1]?.evidence).toEqual([
      "the carpet | was damaged in two rooms",
    ]);
  });

  it("carries settlement, both attestations, and the ledger head hash", () => {
    const rec = settledCase();
    const json = writeMemoJson(rec, ledgerFor(rec.caseId), NOW);
    expect(json.settlement?.amountCents).toBe(90_000);
    expect(json.settlement?.termsDigest).toBe(rec.settlement?.termsDigest);
    expect(json.settlement?.attestations.map((a) => a.party)).toEqual(["A", "B"]);
    expect(json.settlement?.attestations.map((a) => a.callId)).toEqual([
      "call_att_a",
      "call_att_b",
    ]);
    expect(json.ledger).toEqual({ entries: 3, headHash: "hash_ccc333" });
    expect(json.generatedAt).toBe(NOW);
  });

  it("masks phones and never leaks party-private data", () => {
    const rec = settledCase();
    const serialized = JSON.stringify(writeMemoJson(rec, ledgerFor(rec.caseId), NOW));
    expect(serialized).not.toContain("15550000001");
    expect(serialized).not.toContain("15550000002");
    expect(serialized).toContain("***0001");
    expect(serialized).toContain("***0002");
    expect(serialized).not.toContain(PRIVATE_NOTE_A);
    expect(serialized).not.toContain(PRIVATE_NOTE_B);
    expect(serialized).not.toContain(String(RESERVATION_A));
    expect(serialized).not.toContain(String(RESERVATION_B));
  });

  it("represents an unsettled case with a null settlement and null head hash", () => {
    const rec = settledCase();
    delete rec.settlement;
    rec.state = "impasse";
    const json = writeMemoJson(rec, [], NOW);
    expect(json.settlement).toBeNull();
    expect(json.ledger).toEqual({ entries: 0, headHash: null });
  });
});

describe("renderMemo", () => {
  it("renders one table row per round with escaped cells", () => {
    const rec = settledCase();
    const md = renderMemo(rec, ledgerFor(rec.caseId), NOW);
    expect(md).toMatch(/^\| 1 \| A \(Tenant Alex\) \| open \| \$1,200\.00 \|/m);
    expect(md).toMatch(/^\| 2 \| B \(Landlord Sam\) \| counter \| \$600\.00 \|/m);
    expect(md).toMatch(/^\| 3 \| A \(Tenant Alex\) \| counter \| \$900\.00 \|/m);
    expect(md).toMatch(/^\| 4 \| B \(Landlord Sam\) \| accept \| \$900\.00 \|/m);
    // Pipe inside evidence is escaped, so the row still has exactly 6 columns.
    expect(md).toContain("the carpet \\| was damaged in two rooms");
  });

  it("includes parties (masked), settlement terms, attestations, and chain head", () => {
    const rec = settledCase();
    const md = renderMemo(rec, ledgerFor(rec.caseId), NOW);
    expect(md).toContain("| A | Tenant Alex | ***0001 |");
    expect(md).toContain("| B | Landlord Sam | ***0002 |");
    expect(md).not.toContain("15550000001");
    expect(md).not.toContain("15550000002");
    expect(md).toContain("- Amount: $900.00");
    expect(md).toContain(`\`${rec.settlement?.termsDigest}\``);
    expect(md).toContain('"amber falcon nine"');
    expect(md).toContain("`call_att_a`");
    expect(md).toContain("`call_att_b`");
    expect(md).toContain("`hash_ccc333`");
    expect(md).toContain(`- Generated at: ${NOW}`);
  });

  it("always carries the non-binding / not-legal-advice notice", () => {
    const rec = settledCase();
    const md = renderMemo(rec, ledgerFor(rec.caseId), NOW);
    expect(md).toContain(MEMO_NOTICE);
    expect(MEMO_NOTICE).toMatch(/NON-BINDING/);
    expect(MEMO_NOTICE).toMatch(/NOT LEGAL ADVICE/);
  });

  it("never leaks private notes or reservations into markdown", () => {
    const rec = settledCase();
    const md = renderMemo(rec, ledgerFor(rec.caseId), NOW);
    expect(md).not.toContain(PRIVATE_NOTE_A);
    expect(md).not.toContain(PRIVATE_NOTE_B);
    expect(md).not.toContain(String(RESERVATION_A));
    expect(md).not.toContain(String(RESERVATION_B));
  });

  it("is deterministic: identical inputs produce byte-identical output", () => {
    const rec = settledCase();
    const ledger = ledgerFor(rec.caseId);
    const first = renderMemo(rec, ledger, NOW);
    const second = renderMemo(structuredClone(rec), structuredClone(ledger), NOW);
    expect(second).toBe(first);
    expect(
      JSON.stringify(writeMemoJson(structuredClone(rec), structuredClone(ledger), NOW)),
    ).toBe(JSON.stringify(writeMemoJson(rec, ledger, NOW)));
  });

  it("matches the golden snapshot", () => {
    const rec = settledCase();
    expect(renderMemo(rec, ledgerFor(rec.caseId), NOW)).toMatchSnapshot();
  });

  it("states plainly when no settlement was reached", () => {
    const rec = settledCase();
    delete rec.settlement;
    rec.state = "impasse";
    const md = renderMemo(rec, [], NOW);
    expect(md).toContain("_No settlement was reached on this case._");
    expect(md).toContain("- Chain head hash: —");
  });
});
