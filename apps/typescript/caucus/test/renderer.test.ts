/**
 * Adversarial suite for the taint-checked renderer.
 *
 * The claim under test is the one the whole product rests on: party A's
 * private data (reservation bound, intake notes, phone number) can never
 * reach party B's phone call, and vice versa — while the public content
 * shuttle diplomacy actually needs (the other side's latest offer, its
 * conditions, its agreed rationale) DOES get through.
 *
 * Every fixture below plants distinctive sentinels in both parties' private
 * fields so a leak is unmistakable rather than a judgement call:
 *   A: reservation $417.00 (41700c), notes containing "ZEPHYRQUARTZ"
 *   B: reservation $883.00 (88300c), notes containing "MARMALADEHELIX"
 *   both: offer evidence quotes containing "OBSIDIANTHISTLE"
 * No public field of the fixture contains the digit runs 417/41700/883/88300
 * or any part of either phone number, so any hit is a real leak.
 *
 * All phone numbers are fictional (+1555…). Nothing is ever dialed here.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  TaintViolationError,
  assertNoTaint,
  formatUsd,
  publicViewFor,
  renderAttestationCall,
  renderConsentCall,
  renderShuttleCall,
  type TaintSafeView,
} from "../src/renderer.js";
import {
  attestationSchema,
  consentSchema,
  offerRelaySchema,
  validateStrictSubset,
} from "../src/schemas.js";
import type {
  CallOutcome,
  CaseRecord,
  EngineAssessment,
  OfferKind,
  PartyId,
  PartyPrivate,
  RenderedCall,
  Round,
  Settlement,
} from "../src/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Deliberately free of long digit runs: the leak probes below scan digit runs,
// and a case id like "case_..._0001" would collide with a phone's last four.
const CASE_ID = "case_taint_kq7";
const VERTICAL = "security_deposit";
const DISPUTE_CENTS = 120_000; // $1,200

const PHONE_A = "+15550000001";
const PHONE_B = "+15550000002";
const LABEL_A = "Tenant Alex";
const LABEL_B = "Landlord Sam";

const RESERVATION_A = 41_700; // $417.00 — A's private floor
const RESERVATION_B = 88_300; // $883.00 — B's private ceiling

const SENTINEL_A = "ZEPHYRQUARTZ";
const SENTINEL_B = "MARMALADEHELIX";
const SENTINEL_EVIDENCE = "OBSIDIANTHISTLE";

const NOTES_A =
  `${SENTINEL_A} intake: photographed every wall on the walkthrough; ` +
  "privately would accept as little as $417 rather than keep arguing.";
const NOTES_B =
  `${SENTINEL_B} intake: the quote came in lower than expected; ` +
  "privately would pay up to $883 before this becomes worth litigating.";

const PRIVATE_A: PartyPrivate = { reservationCents: RESERVATION_A, notes: NOTES_A };
const PRIVATE_B: PartyPrivate = { reservationCents: RESERVATION_B, notes: NOTES_B };

/** Public offer amounts used by the standard fixture. None collides with a sentinel. */
const OFFER_A1 = 105_000; // $1,050
const OFFER_B2 = 62_500; // $625
const OFFER_A3 = 96_000; // $960
const OFFER_B4 = 73_500; // $735
const SETTLEMENT_CENTS = 84_000; // $840

const COND_A3 = "Landlord confirms the balance is returned by wire";
const COND_B4_1 = "Tenant returns the mailbox key by Friday";
const COND_B4_2 = "Tenant pays the steam clean invoice directly";
const RATIONALE_A3 = "The unit was professionally cleaned at move out";
const RATIONALE_B4 = "Two bedroom blinds need replacing before the next tenancy";

/**
 * The attestation code the parties speak back. `attestationPhrase` is a frozen
 * field name from the earlier word encoding; it now carries a digit code,
 * because words spoken in isolation did not survive a real phone line while
 * digits do (see src/renderer.ts).
 *
 * Held as a fixed literal rather than derived here: the renderer treats the
 * code as opaque and quotes it verbatim, and a literal keeps this fixture's
 * digits under the test's own control — none of "417", "883", "41700",
 * "88300" or either phone's last four occurs inside it, so the leak probes
 * below cannot be tripped or masked by the code's digits.
 */
const ATTESTATION_CODE = "506923";

const SETTLEMENT: Settlement = {
  amountCents: SETTLEMENT_CENTS,
  conditions: [COND_B4_1],
  // Real SHA-256 of {"amountCents":84000,"conditions":["Tenant returns the mailbox key by Friday"]}
  termsDigest: "687f552807796f0df976c6437f81f2b4f9469530e198f616f59d8d137d83f686",
  attestationPhrase: ATTESTATION_CODE,
  attestations: {},
};

interface OfferSpec {
  kind: OfferKind;
  amountCents?: number;
  conditions?: string[];
  publicRationale?: string;
  evidence?: string[];
}

function makeRound(
  n: number,
  callee: PartyId,
  offer?: OfferSpec,
  outcome: CallOutcome = "completed",
): Round {
  const base: Round = {
    n,
    callee,
    outcome,
    startedAt: `2026-07-29T${String(n).padStart(2, "0")}:00:00.000Z`,
    ...(outcome === "pending" ? {} : { completedAt: `2026-07-29T${String(n).padStart(2, "0")}:20:00.000Z` }),
  };
  if (offer === undefined) return base;
  return {
    ...base,
    offer: {
      kind: offer.kind,
      conditions: offer.conditions ?? [],
      evidence: offer.evidence ?? [],
      ...(offer.amountCents !== undefined ? { amountCents: offer.amountCents } : {}),
      ...(offer.publicRationale !== undefined ? { publicRationale: offer.publicRationale } : {}),
    },
  };
}

/** The four-round negotiation used by most tests: A opened, B countered, twice. */
function standardRounds(): Round[] {
  return [
    makeRound(1, "A", {
      kind: "open",
      amountCents: OFFER_A1,
      conditions: [],
      publicRationale: "The apartment was left broom clean",
      evidence: [`${SENTINEL_EVIDENCE} I left the place spotless`],
    }),
    makeRound(2, "B", {
      kind: "counter",
      amountCents: OFFER_B2,
      conditions: ["Tenant covers the repaint of the back bedroom"],
      publicRationale: "The back bedroom wall had to be repainted",
      evidence: [`${SENTINEL_EVIDENCE} the painter invoiced me`],
    }),
    makeRound(3, "A", {
      kind: "counter",
      amountCents: OFFER_A3,
      conditions: [COND_A3],
      publicRationale: RATIONALE_A3,
      evidence: [`${SENTINEL_EVIDENCE} here is the cleaning receipt`],
    }),
    makeRound(4, "B", {
      kind: "counter",
      amountCents: OFFER_B4,
      conditions: [COND_B4_1, COND_B4_2],
      publicRationale: RATIONALE_B4,
      evidence: [`${SENTINEL_EVIDENCE} the blinds quote came in yesterday`],
    }),
  ];
}

interface CaseOpts {
  rounds?: Round[];
  aPrivate?: PartyPrivate;
  bPrivate?: PartyPrivate;
  settlement?: Settlement | null;
  amountCents?: number;
  summary?: string;
}

function makeCase(opts: CaseOpts = {}): CaseRecord {
  const rounds = opts.rounds ?? standardRounds();
  const settlement = opts.settlement === undefined ? SETTLEMENT : opts.settlement;
  return {
    caseId: CASE_ID,
    state: "rounds_active",
    dispute: {
      vertical: VERTICAL,
      summary: opts.summary ?? "Disagreement over how much of a $1,200 security deposit is returned.",
      amountCents: opts.amountCents ?? DISPUTE_CENTS,
      currency: "USD",
    },
    parties: [
      { id: "A", label: LABEL_A, phone: PHONE_A, private: opts.aPrivate ?? PRIVATE_A },
      { id: "B", label: LABEL_B, phone: PHONE_B, private: opts.bPrivate ?? PRIVATE_B },
    ],
    rounds,
    epoch: rounds.length,
    ...(settlement !== null ? { settlement } : {}),
    policy: {
      maxRounds: 8,
      coolingOffMinutes: 0,
      callWindow: { startHour: 9, endHour: 20, timezone: "America/New_York" },
      retryDelaysMinutes: [],
      ttlHours: 72,
    },
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T09:00:00.000Z",
  };
}

function hintOf(nextSuggestionCents?: number): EngineAssessment {
  return {
    impasse: false,
    curve: [],
    ...(nextSuggestionCents !== undefined ? { nextSuggestionCents } : {}),
  };
}

const PARTIES: readonly PartyId[] = ["A", "B"];

function otherOf(p: PartyId): PartyId {
  return p === "A" ? "B" : "A";
}

// ---------------------------------------------------------------------------
// Leak probes — every rendering of the other party's secrets we scan for
// ---------------------------------------------------------------------------

interface LeakProbe {
  /** Rare substrings that exist ONLY inside that party's private notes. */
  sentinels: readonly string[];
  /** The reservation bound in every plausible spoken/written rendering. */
  reservationTexts: readonly string[];
  /** The phone number in every plausible written rendering. */
  phoneTexts: readonly string[];
  /** Full E.164 digits, national 10-digit tail, and the last four digits. */
  phoneDigits: string;
  phoneNational: string;
  phoneLast4: string;
}

function probeFor(party: PartyId): LeakProbe {
  const reservation = party === "A" ? RESERVATION_A : RESERVATION_B;
  const dollars = reservation / 100;
  const phone = party === "A" ? PHONE_A : PHONE_B;
  const digits = phone.replace(/\D+/g, "");
  const national = digits.slice(-10);
  const area = national.slice(0, 3);
  const exch = national.slice(3, 6);
  const last4 = national.slice(-4);
  return {
    sentinels:
      party === "A"
        ? [SENTINEL_A, "ZEPHYR", "QUARTZ", "walkthrough"]
        : [SENTINEL_B, "MARMALADE", "HELIX", "litigating"],
    reservationTexts: [
      String(reservation), // "41700" — raw cents
      String(dollars), // "417"
      `$${dollars}`, // "$417"
      `${dollars}.00`, // "417.00"
      `$${dollars}.00`, // "$417.00"
      `${dollars},00`, // "417,00" — European decimal comma
      `${String(reservation).slice(0, 2)},${String(reservation).slice(2)}`, // "41,700"
    ],
    phoneTexts: [
      phone, // "+15550000001"
      digits, // "15550000001"
      national, // "5550000001"
      `(${area}) ${exch}-${last4}`, // "(555) 000-0001"
      `${area}-${exch}-${last4}`, // "555-000-0001"
      `${area}.${exch}.${last4}`, // "555.000.0001"
      `${area} ${exch} ${last4}`, // "555 000 0001"
      `+1 ${area} ${exch} ${last4}`,
    ],
    phoneDigits: digits,
    phoneNational: national,
    phoneLast4: last4,
  };
}

/** Asserts none of `probe`'s secrets appear in `text` in any scanned form. */
function expectNoLeak(text: string, probe: LeakProbe): void {
  const haystack = text.normalize("NFKC").toLowerCase();
  for (const sentinel of probe.sentinels) {
    expect(haystack).not.toContain(sentinel.toLowerCase());
  }
  for (const amount of probe.reservationTexts) {
    expect(haystack).not.toContain(amount.toLowerCase());
  }
  for (const formatted of probe.phoneTexts) {
    expect(haystack).not.toContain(formatted.toLowerCase());
  }
  // Formatting-stripped scan: catches "5 5 5 - 0 0 0 …" style obfuscation.
  const digitsOnly = haystack.replace(/\D+/g, "");
  expect(digitsOnly).not.toContain(probe.phoneNational);
  expect(digitsOnly).not.toContain(probe.phoneDigits);
  // Last-4 leak: no digit run in the text may contain it.
  for (const run of haystack.match(/\d+/g) ?? []) {
    expect(run).not.toContain(probe.phoneLast4);
  }
}

/**
 * Self-check: an assertion that can never fail proves nothing. Every scan
 * branch of `expectNoLeak` must reject a string with the secret planted in it.
 */
describe("leak probe self-check", () => {
  for (const party of PARTIES) {
    const probe = probeFor(party);
    const planted: Array<[string, string]> = [
      ...probe.sentinels.map((s): [string, string] => [`sentinel ${s}`, `notes said ${s} at intake`]),
      ...probe.reservationTexts.map((t): [string, string] => [`reservation ${t}`, `they would take ${t} flat`]),
      ...probe.phoneTexts.map((t): [string, string] => [`phone ${t}`, `reach them on ${t} directly`]),
      ["digits-only phone", `reach them on ${probe.phoneNational.split("").join(" ")} directly`],
      ["last-four", `the line ending ${probe.phoneLast4} is theirs`],
    ];
    for (const [what, text] of planted) {
      it(`party ${party}: rejects a planted ${what}`, () => {
        expect(() => expectNoLeak(text, probe)).toThrow();
      });
    }
  }
});

const HINT_CENTS = 84_800; // $848 — strictly between the latest offers ($735 / $960)

interface RenderVariant {
  name: string;
  render: (rec: CaseRecord, callee: PartyId) => RenderedCall;
}

const RENDER_VARIANTS: readonly RenderVariant[] = [
  { name: "renderConsentCall", render: (rec, callee) => renderConsentCall(rec, callee) },
  { name: "renderShuttleCall", render: (rec, callee) => renderShuttleCall(rec, callee) },
  {
    name: "renderShuttleCall(+engineHint)",
    render: (rec, callee) => renderShuttleCall(rec, callee, hintOf(HINT_CENTS)),
  },
  { name: "renderAttestationCall", render: (rec, callee) => renderAttestationCall(rec, callee) },
];

// ---------------------------------------------------------------------------
// Layer 1 — the projection itself
// ---------------------------------------------------------------------------

describe("publicViewFor", () => {
  it("exposes the callee's own dial-able identity and only a label for the other party", () => {
    const rec = makeCase();
    const view = publicViewFor(rec, "A");
    expect(view.callee).toEqual({ id: "A", label: LABEL_A, phone: PHONE_A });
    expect(view.other).toEqual({ id: "B", label: LABEL_B });
    expect(Object.keys(view.other).sort()).toEqual(["id", "label"]);
    expect(view.caseId).toBe(CASE_ID);
    expect(view.dispute).toEqual({
      vertical: VERTICAL,
      summary: rec.dispute.summary,
      amountCents: DISPUTE_CENTS,
      currency: "USD",
    });
  });

  it("has no key anywhere in the projection that could carry PartyPrivate", () => {
    for (const callee of PARTIES) {
      const view = publicViewFor(makeCase(), callee);
      const keys = collectKeys(view);
      expect([...keys].filter((k) => k === "private" || k === "notes" || k === "reservationCents")).toEqual([]);
      // The only `phone` in the projection is the callee's own dial target.
      expect([...keys].filter((k) => k === "phone")).toEqual(["phone"]);
    }
  });

  it("serializes with no trace of the other party's private data (runtime scan)", () => {
    for (const callee of PARTIES) {
      const serialized = JSON.stringify(publicViewFor(makeCase(), callee));
      expectNoLeak(serialized, probeFor(otherOf(callee)));
    }
  });

  it("relays the other party's LATEST open/counter and drops evidence provenance", () => {
    const view = publicViewFor(makeCase(), "A");
    expect(view.offerFromOther).toEqual({
      round: 4,
      kind: "counter",
      amountCents: OFFER_B4,
      conditions: [COND_B4_1, COND_B4_2],
      publicRationale: RATIONALE_B4,
    });
    expect(view.offerFromCallee?.amountCents).toBe(OFFER_A3);
    expect(Object.keys(view.offerFromOther ?? {})).not.toContain("evidence");
  });

  it("ignores accept/reject/no_response rounds and amount-less offers when picking the relay", () => {
    const rounds = [
      ...standardRounds(),
      makeRound(5, "A", { kind: "counter", amountCents: 90_000 }),
      makeRound(6, "B", { kind: "reject", conditions: [] }),
      makeRound(7, "B", { kind: "counter", conditions: [] }), // counter with no amount
      makeRound(8, "B", { kind: "no_response", conditions: [] }),
    ];
    const view = publicViewFor(makeCase({ rounds }), "A");
    expect(view.offerFromOther?.round).toBe(4);
    expect(view.offerFromOther?.amountCents).toBe(OFFER_B4);
  });

  it("omits offers entirely before either party has proposed anything", () => {
    const view = publicViewFor(makeCase({ rounds: [], settlement: null }), "A");
    expect(view.offerFromOther).toBeUndefined();
    expect(view.offerFromCallee).toBeUndefined();
    expect(view.settlement).toBeUndefined();
    expect(view.nextRound).toBe(1);
  });

  it("nextRound reuses a pending round's number and otherwise advances past the last", () => {
    expect(publicViewFor(makeCase(), "A").nextRound).toBe(5);
    const withPending = [...standardRounds(), makeRound(9, "A", undefined, "pending")];
    expect(publicViewFor(makeCase({ rounds: withPending }), "A").nextRound).toBe(9);
  });

  it("throws when the requested party is not on the case", () => {
    const rec = makeCase();
    const broken = { ...rec, parties: [rec.parties[0], rec.parties[0]] } as unknown as CaseRecord;
    expect(() => publicViewFor(broken, "B")).toThrow(/no party with id "B"/);
  });
});

/**
 * Type-level companion to the runtime key scan above: these fail to compile if
 * the view type ever grows a path to party-private data or the other party's
 * phone. (Runtime assertions above are what fail the suite; these fail `tsc`.)
 */
type OtherPartyKeys = keyof TaintSafeView["other"];
const _otherPartyIsLabelOnly: [Exclude<OtherPartyKeys, "id" | "label">] extends [never] ? true : never = true;
type RelayableOfferKeys = keyof NonNullable<TaintSafeView["offerFromOther"]>;
const _relayCarriesNoEvidence: [Extract<RelayableOfferKeys, "evidence" | "notes">] extends [never]
  ? true
  : never = true;
void _otherPartyIsLabelOnly;
void _relayCarriesNoEvidence;

function collectKeys(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
    return out;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      out.add(key);
      collectKeys(child, out);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The headline invariant — nothing private crosses, on any render, either way
// ---------------------------------------------------------------------------

describe("cross-party isolation", () => {
  for (const variant of RENDER_VARIANTS) {
    for (const callee of PARTIES) {
      it(`${variant.name} → party ${callee}: leaks none of party ${otherOf(callee)}'s private data`, () => {
        const rendered = variant.render(makeCase(), callee);
        expectNoLeak(rendered.task, probeFor(otherOf(callee)));
      });

      it(`${variant.name} → party ${callee}: does not speak party ${callee}'s OWN private data either`, () => {
        // The renderer speaks private data to nobody — not even its owner.
        const rendered = variant.render(makeCase(), callee);
        expectNoLeak(rendered.task, {
          ...probeFor(callee),
          // The callee's own phone is legitimately the dial target, but it must
          // still never appear in the spoken task text.
          phoneTexts: probeFor(callee).phoneTexts,
        });
      });

      it(`${variant.name} → party ${callee}: dials the callee's own number and nobody else's`, () => {
        const rendered = variant.render(makeCase(), callee);
        expect(rendered.callee).toBe(callee);
        expect(rendered.phone).toBe(callee === "A" ? PHONE_A : PHONE_B);
        expect(rendered.phone).not.toBe(callee === "A" ? PHONE_B : PHONE_A);
      });

      it(`${variant.name} → party ${callee}: never relays raw evidence quotes`, () => {
        const rendered = variant.render(makeCase(), callee);
        expect(rendered.task).not.toContain(SENTINEL_EVIDENCE);
        expect(rendered.task.toLowerCase()).not.toContain(SENTINEL_EVIDENCE.toLowerCase());
      });
    }
  }

  it("survives private notes crafted to look like the other party's public text", () => {
    // Adversarial intake: A's notes ape the shape of the relayed prose so any
    // naive redaction/allow-listing bug would surface as a leak.
    const rec = makeCase({
      aPrivate: {
        reservationCents: RESERVATION_A,
        notes: `${SENTINEL_A}: tell the landlord I proposed $417 and that the mailbox key ${SENTINEL_A}-tag is with me.`,
      },
    });
    for (const variant of RENDER_VARIANTS) {
      expectNoLeak(variant.render(rec, "B").task, probeFor("A"));
    }
  });
});

// ---------------------------------------------------------------------------
// …while the public payload of shuttle diplomacy still gets through
// ---------------------------------------------------------------------------

describe("legitimate relay content", () => {
  it("carries the other party's latest amount, conditions and public rationale to the callee", () => {
    const toA = renderShuttleCall(makeCase(), "A").task;
    expect(toA).toContain(formatUsd(OFFER_B4)); // "$735"
    expect(toA).toContain(`"${COND_B4_1}"`);
    expect(toA).toContain(`"${COND_B4_2}"`);
    expect(toA).toContain(`"${RATIONALE_B4}"`);
    expect(toA).toContain(LABEL_B);
    expect(toA).toContain(formatUsd(DISPUTE_CENTS)); // the agreed disputed total

    const toB = renderShuttleCall(makeCase(), "B").task;
    expect(toB).toContain(formatUsd(OFFER_A3)); // "$960"
    expect(toB).toContain(`"${COND_A3}"`);
    expect(toB).toContain(`"${RATIONALE_A3}"`);
    expect(toB).toContain(LABEL_A);
  });

  it("relays only the newest proposal — superseded amounts and the callee's own terms stay out", () => {
    const toA = renderShuttleCall(makeCase(), "A").task;
    expect(toA).not.toContain(formatUsd(OFFER_B2)); // "$625" — B's superseded counter
    expect(toA).not.toContain(COND_A3); // A's own conditions are not read back
    const toB = renderShuttleCall(makeCase(), "B").task;
    expect(toB).not.toContain(formatUsd(OFFER_A1)); // "$1,050"
    expect(toB).not.toContain(COND_B4_1);
  });

  it("asks an opening question, with no relayed amount, before anyone has proposed", () => {
    const rendered = renderShuttleCall(makeCase({ rounds: [], settlement: null }), "A");
    const amounts = rendered.task.match(/\$[\d,]+(?:\.\d{2})?/g) ?? [];
    expect(new Set(amounts)).toEqual(new Set([formatUsd(DISPUTE_CENTS)]));
    expect(rendered.task).not.toContain(LABEL_B); // nothing of B's to convey yet
    expect(rendered.round).toBe(1);
  });

  it("reads the settlement terms and the attestation code to both parties verbatim", () => {
    for (const callee of PARTIES) {
      const task = renderAttestationCall(makeCase(), callee).task;
      expect(task).toContain(formatUsd(SETTLEMENT_CENTS)); // "$840"
      expect(task).toContain(`"${COND_B4_1}"`);
      expect(task).toContain(`"${SETTLEMENT.attestationPhrase}"`);
    }
  });

  it("renders the no-conditions settlement without an empty quote list", () => {
    const rec = makeCase({ settlement: { ...SETTLEMENT, conditions: [] } });
    const task = renderAttestationCall(rec, "A").task;
    expect(task).toContain(formatUsd(SETTLEMENT_CENTS));
    expect(task).not.toContain('""');
  });

  it("refuses to render an attestation call for a case with no settlement", () => {
    expect(() => renderAttestationCall(makeCase({ settlement: null }), "A")).toThrow(
      /no settlement to attest/,
    );
  });
});

// ---------------------------------------------------------------------------
// Prompt defects measured on real calls (2026-07-30) — regression suites
// ---------------------------------------------------------------------------

/**
 * Live calls showed the word phrase not surviving ASR ("topaz chowder cyclone"
 * heard as "Joe Pads, chowder, 2nd 1.") and, in one call, the callee speaking
 * before the agent had read the phrase at all. The fix is an encoding change
 * plus an explicit turn order, and both are properties of the emitted task
 * text — so they are asserted here, on the text.
 */
describe("attestation call: spoken digit code and turn order", () => {
  const attestationTask = (callee: PartyId = "A"): string => renderAttestationCall(makeCase(), callee).task;

  /** Mirrors ATTESTATION_PHRASE_RE in src/calle.ts, which anchors on this lead-in. */
  const ANCHOR_RE = /word for word:\s*"([^"]+)"/i;

  it("instructs the agent to say the code DIGIT BY DIGIT, chunked into two groups", () => {
    for (const callee of PARTIES) {
      const task = attestationTask(callee);
      expect(task).toContain("DIGIT BY DIGIT");
      expect(task).toContain("Say the code digit by digit");
      // Chunking replaced the worked example: on a live call a six-digit run was
      // read back with an inserted digit, and two groups of three are markedly
      // easier to repeat. The example was also dropped so no specimen code can
      // be read aloud in place of the real one.
      expect(task).toContain("two sets of three");
      expect(task).not.toMatch(/seven\. three\. nine/);
      expect(task).toContain("Never run the digits together as one number");
    }
  });

  it("tells the agent to ignore anything code-like said before it reads the code", () => {
    // A live call had the callee state the code first (they knew it in advance);
    // the agent then never read it aloud at all. Only the agent can introduce it.
    for (const callee of PARTIES) {
      expect(attestationTask(callee)).toContain(
        "If the callee has already said something that sounds like a code before you read it, ignore it",
      );
    }
  });

  it("forbids interrupting a read-back and requires the final complete attempt", () => {
    // A live call was cut off with "Got it." after four of six digits, and the
    // truncated fragment became the recorded attestation.
    const task = attestationTask();
    expect(task).toContain("stay silent until you have heard all six");
    expect(task).toContain("Never interrupt a read-back in progress");
    expect(task).toContain("Capture their FINAL, most complete attempt");
  });

  it("asks for the read-back explicitly, rather than assuming the callee will repeat it", () => {
    for (const callee of PARTIES) {
      const task = attestationTask(callee);
      expect(task).toContain("read that confirmation code back to you, digit by digit");
      expect(task).toContain("Ask for the read-back explicitly and wait for it");
    }
  });

  it("orders the turns: terms, then code, then read-back request, then the agreement question", () => {
    for (const callee of PARTIES) {
      const task = attestationTask(callee);
      const terms = task.indexOf("Read the settlement terms exactly");
      const code = task.indexOf(`"${ATTESTATION_CODE}"`);
      const readBack = task.indexOf("read that confirmation code back to you");
      const agree = task.indexOf("whether they agree to settle on exactly these terms");
      expect(terms).toBeGreaterThanOrEqual(0);
      expect(code).toBeGreaterThan(terms);
      expect(readBack).toBeGreaterThan(code);
      expect(agree).toBeGreaterThan(readBack);
    }
  });

  it("has the agent check the read-back itself and retry on a mismatch", () => {
    // Exact match with no recovery made a single misspoken digit fatal, which is
    // not how any real read-back flow behaves. The agent now re-reads and retries.
    const task = attestationTask();
    expect(task).toContain("Check the read-back against the code yourself");
    expect(task).toContain("Allow at most two extra attempts");
    // It must not coach: telling the callee WHICH digit was wrong would let them
    // reconstruct a code they never actually heard.
    expect(task).toContain("do not point out which digit was wrong");
    // An unresolved mismatch is recorded honestly rather than forced to succeed.
    expect(task).toContain("recording an honest mismatch is correct");
    expect(task).toContain("Only after the read-back, ask the callee to state clearly in their own words");
  });

  it("requires the read-back captured verbatim, uncorrected and unnormalized", () => {
    const task = attestationTask();
    expect(task).toContain("attempt verbatim, exactly as they speak it");
    expect(task).toContain("whether they say digits or number words");
    expect(task).toContain("do not tidy it into a single number");
    expect(task).toContain("never fill in a digit they did not say");
  });

  it("explains that the code is a fingerprint of these exact terms", () => {
    const task = attestationTask();
    expect(task).toContain("the code is a fingerprint of these exact terms");
    expect(task).toContain("both parties heard the same settlement");
  });

  it("keeps the code inside the lead-in the CALL-E mock anchors on, and says it once", () => {
    for (const callee of PARTIES) {
      const task = attestationTask(callee);
      // First match wins in the mock, and settlement conditions are quoted
      // EARLIER in the task — the anchor is what keeps them from being echoed.
      expect(ANCHOR_RE.exec(task)?.[1]).toBe(ATTESTATION_CODE);
      expect(task.split(`"${ATTESTATION_CODE}"`).length - 1).toBe(1);
    }
  });

  it("quotes whatever the frozen attestationPhrase field holds, including a legacy word phrase", () => {
    // Settlement.attestationPhrase is frozen by name and opaque to the
    // renderer: records written under the old word encoding still render.
    const legacy = makeCase({ settlement: { ...SETTLEMENT, attestationPhrase: "jigsaw maple giraffe" } });
    const task = renderAttestationCall(legacy, "A").task;
    expect(ANCHOR_RE.exec(task)?.[1]).toBe("jigsaw maple giraffe");
  });

  it("still passes the taint scan for both callees on the multi-round sentinel fixture", () => {
    const rec = makeCase(); // four rounds, both parties carrying private sentinels
    expect(rec.rounds.length).toBeGreaterThan(1);
    for (const callee of PARTIES) {
      const task = renderAttestationCall(rec, callee).task;
      expect(() => assertNoTaint(task, rec, callee)).not.toThrow();
      expectNoLeak(task, probeFor(otherOf(callee)));
      expectNoLeak(task, probeFor(callee));
    }
  });
});

/**
 * Live call, shuttle leg: after the callee stated a counter of $960 the agent
 * asked whether they wanted to ACCEPT that $960 — inviting a party to accept
 * their own offer. Structurally incoherent, and it produced a confusing
 * "I accept it" inside a counter round.
 */
describe("shuttle call: a party is never asked to accept their own counter", () => {
  it("forbids asking the callee to accept, reject or re-decide their own counter", () => {
    for (const callee of PARTIES) {
      const task = renderShuttleCall(makeCase(), callee).task;
      expect(task).toContain(
        "Never ask the callee to accept, reject or re-decide their own counter-offer",
      );
      expect(task).toContain("a party never responds to their own proposal");
      expect(task).toContain("carried to the other party in the next round");
    }
  });

  it("frames the accept/reject/counter decision as being about the OTHER party's proposal", () => {
    const task = renderShuttleCall(makeCase(), "A").task;
    expect(task).toContain("the proposal you just relayed, which the other party made");
    expect(task).toContain("That decision is about the other party's proposal only");
  });

  it("closes the call after one confirming read-back of what was captured", () => {
    const task = renderShuttleCall(makeCase(), "A").task;
    expect(task).toContain("read back once what you captured");
    expect(task).toContain("the amount, any conditions, and any reasoning they agreed to share");
    expect(task).toContain("Then thank them and end the call");
    // Ordering: capture-and-close comes after the ask it governs.
    expect(task.indexOf("read back once what you captured")).toBeGreaterThan(
      task.indexOf("Ask how the callee responds to that proposal"),
    );
  });

  it("applies the same rule on the opening round, where the callee's amount is also their own", () => {
    const opening = renderShuttleCall(makeCase({ rounds: [], settlement: null }), "A").task;
    expect(opening).toContain("No proposal has been made yet in this mediation");
    expect(opening).toContain(
      "Never ask the callee to accept, reject or re-decide their own counter-offer",
    );
  });

  it("keeps the neutrality rules and the never-relay-private rule alongside the new instruction", () => {
    for (const callee of PARTIES) {
      const task = renderShuttleCall(makeCase(), callee, hintOf(HINT_CENTS)).task;
      expect(task).toContain("Anything the callee marks as private must never be relayed onward");
      expect(task).toContain("Neutrality rules for the entire call");
      expect(task).toContain("never share opinions about who is right");
    }
  });

  it("still passes the taint scan for both callees on the multi-round sentinel fixture", () => {
    const rec = makeCase(); // four rounds, both parties carrying private sentinels
    for (const callee of PARTIES) {
      for (const task of [
        renderShuttleCall(rec, callee).task,
        renderShuttleCall(rec, callee, hintOf(HINT_CENTS)).task,
      ]) {
        expect(() => assertNoTaint(task, rec, callee)).not.toThrow();
        expectNoLeak(task, probeFor(otherOf(callee)));
        expectNoLeak(task, probeFor(callee));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// engineHint straddle rule
// ---------------------------------------------------------------------------

describe("engineHint straddle rule", () => {
  const hintCase = (aCents?: number, bCents?: number): CaseRecord => {
    const rounds: Round[] = [];
    if (aCents !== undefined) rounds.push(makeRound(1, "A", { kind: "open", amountCents: aCents }));
    if (bCents !== undefined) rounds.push(makeRound(2, "B", { kind: "counter", amountCents: bCents }));
    return makeCase({ rounds, settlement: null, aPrivate: {}, bPrivate: {} });
  };

  it("voices the suggestion when the two latest offers straddle it", () => {
    const task = renderShuttleCall(hintCase(100_000, 60_000), "B", hintOf(80_000)).task;
    expect(task).toContain(formatUsd(80_000));
  });

  it("includes a suggestion sitting exactly on either endpoint (inclusive bounds)", () => {
    expect(renderShuttleCall(hintCase(100_000, 60_000), "B", hintOf(60_000)).task).toContain(
      formatUsd(60_000),
    );
    expect(renderShuttleCall(hintCase(100_000, 60_000), "B", hintOf(100_000)).task).toContain(
      formatUsd(100_000),
    );
  });

  it("suppresses a suggestion outside the straddle interval, on either side", () => {
    const above = renderShuttleCall(hintCase(100_000, 60_000), "B", hintOf(100_100)).task;
    expect(above).not.toContain(formatUsd(100_100));
    const below = renderShuttleCall(hintCase(100_000, 60_000), "B", hintOf(59_900)).task;
    expect(below).not.toContain(formatUsd(59_900));
  });

  it("suppresses the suggestion when only one side has proposed", () => {
    const onlyA = renderShuttleCall(hintCase(100_000, undefined), "B", hintOf(90_000)).task;
    expect(onlyA).not.toContain(formatUsd(90_000));
    const onlyB = renderShuttleCall(hintCase(undefined, 60_000), "A", hintOf(50_000)).task;
    expect(onlyB).not.toContain(formatUsd(50_000));
  });

  it("suppresses the suggestion when the two offers already agree (degenerate interval)", () => {
    const task = renderShuttleCall(hintCase(70_000, 70_000), "B", hintOf(70_000)).task;
    const occurrences = task.split(formatUsd(70_000)).length - 1;
    // The relayed offer itself is spoken once; the suggestion adds no second mention.
    expect(occurrences).toBe(1);
  });

  it("omits the suggestion when the engine assessment has none", () => {
    const withHint = renderShuttleCall(makeCase(), "A", hintOf(HINT_CENTS)).task;
    const withoutHint = renderShuttleCall(makeCase(), "A", hintOf()).task;
    const bare = renderShuttleCall(makeCase(), "A").task;
    expect(withoutHint).toBe(bare);
    expect(withHint).not.toBe(bare);
    expect(withHint).toContain(formatUsd(HINT_CENTS));
  });

  it("FAILS CLOSED when a straddling suggestion collides with the other party's private bound", () => {
    // A's private floor is $417. A public midpoint that lands exactly on it is
    // textually indistinguishable from a leak, so the render must refuse.
    const rec = makeCase({
      rounds: [
        makeRound(1, "A", { kind: "open", amountCents: 60_000 }),
        makeRound(2, "B", { kind: "counter", amountCents: 30_000 }),
      ],
      settlement: null,
    });
    expect(() => renderShuttleCall(rec, "B", hintOf(RESERVATION_A))).toThrow(TaintViolationError);
    // …and the same suggestion is fine for the party who owns that number.
    expect(() => renderShuttleCall(rec, "A", hintOf(RESERVATION_A))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Layer 3 — the tripwire itself must be load-bearing
// ---------------------------------------------------------------------------

describe("assertNoTaint (poison tests)", () => {
  const rec = makeCase();

  it("passes every legitimately rendered task, for both callees", () => {
    for (const variant of RENDER_VARIANTS) {
      for (const callee of PARTIES) {
        const task = variant.render(rec, callee).task;
        expect(() => assertNoTaint(task, rec, callee)).not.toThrow();
      }
    }
  });

  it("throws TaintViolationError naming the callee and the note token", () => {
    const poisoned = `You are calling ${LABEL_B}. Background: ${SENTINEL_A} came up on the earlier call.`;
    expect(() => assertNoTaint(poisoned, rec, "B")).toThrow(TaintViolationError);
    let thrown: unknown;
    try {
      assertNoTaint(poisoned, rec, "B");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(TaintViolationError);
    const violation = thrown as TaintViolationError;
    expect(violation.name).toBe("TaintViolationError");
    expect(violation.callee).toBe("B");
    expect(violation.violations).toEqual([`private-note token "${SENTINEL_A.toLowerCase()}"`]);
    expect(violation.message).toContain("party B");
  });

  it("catches the reservation in raw cents", () => {
    expect(() => assertNoTaint(`Their floor is 41700 cents.`, rec, "B")).toThrow(TaintViolationError);
    expect(violationsOf(`Their floor is 41700 cents.`, rec, "B")).toContain(
      `reservation amount as "41700"`,
    );
  });

  it("catches the reservation in dollar-and-cents form", () => {
    expect(violationsOf(`They would take $417.00 to close this.`, rec, "B")).toContain(
      `reservation amount as "417.00"`,
    );
  });

  it("catches the reservation as bare dollars at a sentence boundary", () => {
    expect(violationsOf(`They would take $417.`, rec, "B")).toContain(`reservation amount as "417"`);
  });

  it("catches the other party's phone in national and E.164 formatting alike", () => {
    expect(violationsOf(`Call them back on (555) 000-0001 if needed.`, rec, "B")).toContain(
      `phone digit sequence ending "0001"`,
    );
    expect(violationsOf(`Their line is +1 555 000 0001.`, rec, "B")).toContain(
      `phone digit sequence ending "0001"`,
    );
    // Formatting-agnostic: digits separated by anything at all still hit.
    expect(violationsOf(`Reach them at 5-5-5 / 0 0 0 / 0.0.0.1 today.`, rec, "B")).toContain(
      `phone digit sequence ending "0001"`,
    );
  });

  it("catches a distinctive number that appears only in the other party's notes", () => {
    // B's notes mention $883; it is not a public amount on this case.
    expect(violationsOf(`The number 883 came up.`, rec, "A")).toEqual(
      expect.arrayContaining([`reservation amount as "883"`, `private-note number "883"`]),
    );
  });

  it("aggregates every distinct violation in one throw", () => {
    const poisoned = `${SENTINEL_A} — they will take 41700 cents; their number is 555-000-0001.`;
    const violations = violationsOf(poisoned, rec, "B");
    expect(violations).toEqual(
      expect.arrayContaining([
        `private-note token "${SENTINEL_A.toLowerCase()}"`,
        `reservation amount as "41700"`,
        `phone digit sequence ending "0001"`,
      ]),
    );
    expect(violations.length).toBeGreaterThanOrEqual(3);
  });

  it("is direction-sensitive: a party's own secrets are not a cross-party violation", () => {
    const ownData = `${SENTINEL_B} and 88300 and +15550000002`;
    expect(() => assertNoTaint(ownData, rec, "B")).not.toThrow();
    expect(() => assertNoTaint(ownData, rec, "A")).toThrow(TaintViolationError);
  });

  it("does not false-positive on digit-boundary lookalikes", () => {
    // "417" inside a longer run, across a separator, or as a decimal fragment
    // is not a leak — the guard would be useless if it were this trigger-happy.
    expect(() => assertNoTaint(`The audit reference was 84170 on the paperwork.`, rec, "B")).not.toThrow();
    expect(() => assertNoTaint(`We recorded 1,417,000 minutes of audio.`, rec, "B")).not.toThrow();
    expect(() => assertNoTaint(`The amount is $2,417.10 after fees.`, rec, "B")).not.toThrow();
  });

  it("exempts an amount the owner has already offered out loud", () => {
    // B privately would take $735 — and has publicly offered exactly that, so
    // relaying "$735" to A is disclosure by the owner, not a leak.
    const selfDisclosed = makeCase({ bPrivate: { reservationCents: OFFER_B4, notes: NOTES_B } });
    const rendered = renderShuttleCall(selfDisclosed, "A");
    expect(rendered.task).toContain(formatUsd(OFFER_B4));
    expect(() => assertNoTaint(rendered.task, selfDisclosed, "A")).not.toThrow();
  });

  it("has nothing to scan when a party disclosed no private data", () => {
    const bare = makeCase({ aPrivate: {}, bPrivate: {} });
    expect(() => assertNoTaint("Any text at all, 41700 and 88300.", bare, "B")).not.toThrow();
  });

  it("protects the phone number unconditionally, even with no private data on file", () => {
    const bare = makeCase({ aPrivate: {}, bPrivate: {} });
    expect(violationsOf("Reach them directly on +15550000001.", bare, "B")).toEqual([
      `phone digit sequence ending "0001"`,
    ]);
  });
});

function violationsOf(task: string, rec: CaseRecord, callee: PartyId): readonly string[] {
  try {
    assertNoTaint(task, rec, callee);
  } catch (err) {
    if (err instanceof TaintViolationError) return err.violations;
    throw err;
  }
  throw new Error("expected assertNoTaint to throw, but it passed");
}

// ---------------------------------------------------------------------------
// Call envelope: dial target, schema, idempotency
// ---------------------------------------------------------------------------

describe("rendered call envelope", () => {
  it("uses the caseId:round:callee:purpose idempotency key shape", () => {
    const rec = makeCase();
    expect(renderConsentCall(rec, "A").idempotencyKey).toBe(`${CASE_ID}:0:A:consent`);
    expect(renderConsentCall(rec, "B").idempotencyKey).toBe(`${CASE_ID}:0:B:consent`);
    expect(renderShuttleCall(rec, "A").idempotencyKey).toBe(`${CASE_ID}:5:A:shuttle`);
    expect(renderAttestationCall(rec, "B").idempotencyKey).toBe(`${CASE_ID}:4:B:attestation`);
  });

  it("keys a shuttle retry to the pending round, not to a new one", () => {
    const rounds = [...standardRounds(), makeRound(9, "A", undefined, "pending")];
    const rendered = renderShuttleCall(makeCase({ rounds }), "A");
    expect(rendered.round).toBe(9);
    expect(rendered.idempotencyKey).toBe(`${CASE_ID}:9:A:shuttle`);
  });

  it("is byte-stable across identical renders (idempotency actually holds)", () => {
    const rec = makeCase();
    for (const variant of RENDER_VARIANTS) {
      for (const callee of PARTIES) {
        const first = variant.render(rec, callee);
        const second = variant.render(makeCase(), callee);
        expect(second).toEqual(first);
        expect(second.idempotencyKey).toBe(first.idempotencyKey);
        expect(second.task).toBe(first.task);
      }
    }
  });

  it("attaches purpose and vertical metadata to every call", () => {
    const rec = makeCase();
    expect(renderConsentCall(rec, "A").metadata).toEqual({ purpose: "consent", vertical: VERTICAL });
    expect(renderShuttleCall(rec, "A").metadata).toEqual({ purpose: "shuttle", vertical: VERTICAL });
    expect(renderAttestationCall(rec, "A").metadata).toEqual({
      purpose: "attestation",
      vertical: VERTICAL,
    });
  });

  it("ships the matching strict-subset result schema for each purpose", () => {
    const rec = makeCase();
    expect(renderConsentCall(rec, "A").resultSchema).toEqual(consentSchema());
    expect(renderShuttleCall(rec, "A").resultSchema).toEqual(offerRelaySchema(DISPUTE_CENTS / 100));
    expect(renderAttestationCall(rec, "A").resultSchema).toEqual(attestationSchema());
    for (const variant of RENDER_VARIANTS) {
      expect(() => validateStrictSubset(variant.render(rec, "A").resultSchema)).not.toThrow();
    }
  });

  it("formatUsd renders whole and fractional dollars deterministically", () => {
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(735)).toBe("$7.35");
    expect(formatUsd(73_500)).toBe("$735");
    expect(formatUsd(120_000)).toBe("$1,200");
    expect(formatUsd(1_234_567)).toBe("$12,345.67");
    expect(() => formatUsd(-1)).toThrow(RangeError);
    expect(() => formatUsd(1.5)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Property: private data cannot influence — let alone reach — a rendered task
// ---------------------------------------------------------------------------

/**
 * These three helpers mirror the documented scan rule of src/renderer.ts so the
 * property can distinguish the two legitimate outcomes: a render either matches
 * the private-free baseline exactly, or fails closed because a private amount is
 * textually indistinguishable from public case text.
 */
function groupThousandsLocal(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function amountTextsLocal(cents: number): string[] {
  const dollars = Math.trunc(cents / 100);
  const rem = cents % 100;
  const plain = String(dollars);
  const grouped = groupThousandsLocal(dollars);
  const texts = [String(cents), `${plain}.${String(rem).padStart(2, "0")}`, `${grouped}.${String(rem).padStart(2, "0")}`];
  if (rem === 0) texts.push(plain, grouped);
  return texts;
}

function guardedLocal(text: string): RegExp {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<!\\d)(?<!\\d[.,])${escaped}(?!\\d)(?![.,]\\d)`);
}

function wordPatternLocal(token: string): RegExp {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "u");
}

function tokenizeLocal(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

const PUBLIC_CENTS: ReadonlySet<number> = new Set([
  DISPUTE_CENTS,
  OFFER_A1,
  OFFER_B2,
  OFFER_A3,
  OFFER_B4,
  SETTLEMENT_CENTS,
]);

const PUBLIC_AMOUNT_TEXTS: ReadonlySet<string> = new Set(
  [...PUBLIC_CENTS].flatMap((c) => [String(c), String(Math.trunc(c / 100))]),
);

describe("property: private fields are inert", () => {
  const baselineCase = makeCase({ aPrivate: {}, bPrivate: {} });
  const baselineTasks = new Map<string, string>();
  for (const variant of RENDER_VARIANTS) {
    for (const callee of PARTIES) {
      baselineTasks.set(`${variant.name}|${callee}`, variant.render(baselineCase, callee).task);
    }
  }
  /** Every word any legitimate render of this case can emit. */
  const baselineVocabulary = new Set([...baselineTasks.values()].flatMap(tokenizeLocal));

  /** Notes: full-unicode, punctuation-heavy, sometimes carrying digit runs. */
  const notesArb = fc.oneof(
    fc.string({ unit: "binary", maxLength: 300 }),
    fc.string({ unit: "grapheme", maxLength: 300 }),
    fc.constantFrom(
      `${SENTINEL_A} they hinted 735 privately`,
      `${SENTINEL_B} 848 came up off the record`,
      "no digits, just prose about the walkthrough",
    ),
  );
  /**
   * Reservations: mostly arbitrary, but deliberately seeded with amounts that
   * collide textually with public case text ($7.35, $8.40, $8.48, $9.60,
   * $848.00) and with amounts the owner has publicly offered — so both the
   * fail-closed and the self-disclosure-exempt branches get exercised.
   */
  const reservationArb = fc.oneof(
    fc.integer({ min: 1, max: 9_999_999 }),
    fc.constantFrom(735, 840, 848, 960, 84_800, OFFER_B4, OFFER_A3, SETTLEMENT_CENTS, DISPUTE_CENTS),
  );

  it("no random note or reservation changes the rendered task — or it fails closed", () => {
    let failedClosed = 0;
    let renderedIdentically = 0;
    fc.assert(
      fc.property(
        notesArb,
        notesArb,
        reservationArb,
        reservationArb,
        (notesA, notesB, reservationA, reservationB) => {
          const rec = makeCase({
            aPrivate: { reservationCents: reservationA, notes: notesA },
            bPrivate: { reservationCents: reservationB, notes: notesB },
          });

          for (const variant of RENDER_VARIANTS) {
            for (const callee of PARTIES) {
              const other = otherOf(callee);
              const baseline = baselineTasks.get(`${variant.name}|${callee}`) as string;
              const notes = other === "A" ? notesA : notesB;
              const reservation = other === "A" ? reservationA : reservationB;

              // The implementation's documented fail-closed rule, applied to the
              // task the renderer would otherwise produce.
              const norm = baseline.normalize("NFKC").toLowerCase();
              const suspectTexts: string[] = [];
              if (!PUBLIC_CENTS.has(reservation)) suspectTexts.push(...amountTextsLocal(reservation));
              for (const run of new Set(notes.match(/\d{3,}/g) ?? [])) {
                if (!PUBLIC_AMOUNT_TEXTS.has(run)) suspectTexts.push(run);
              }
              const mustFailClosed = suspectTexts.some((t) => guardedLocal(t).test(norm));

              if (mustFailClosed) {
                expect(() => variant.render(rec, callee)).toThrow(TaintViolationError);
                failedClosed++;
                continue;
              }

              const task = variant.render(rec, callee).task;
              renderedIdentically++;
              // 1. Private data had literally no influence on the output.
              expect(task).toBe(baseline);
              // 2. And, stated directly: no distinctive note word reached it.
              const haystack = task.normalize("NFKC").toLowerCase();
              for (const token of new Set(tokenizeLocal(notes))) {
                if (token.length < 4 || baselineVocabulary.has(token)) continue;
                expect(wordPatternLocal(token).test(haystack)).toBe(false);
              }
              // 3. Nor the reservation, in any rendering, unless publicly offered.
              if (!PUBLIC_CENTS.has(reservation)) {
                for (const text of amountTextsLocal(reservation)) {
                  expect(guardedLocal(text).test(haystack)).toBe(false);
                }
              }
            }
          }
        },
      ),
      { numRuns: 250 },
    );
    // Both outcomes must actually have been observed, or the property is vacuous.
    expect(renderedIdentically).toBeGreaterThan(0);
    expect(failedClosed).toBeGreaterThan(0);
  });

  it("holds for pathologically long private notes", () => {
    const long = `${SENTINEL_A} `.repeat(4000);
    const rec = makeCase({ aPrivate: { reservationCents: RESERVATION_A, notes: long } });
    for (const variant of RENDER_VARIANTS) {
      expectNoLeak(variant.render(rec, "B").task, probeFor("A"));
    }
  });
});

// ---------------------------------------------------------------------------
// Thousands-grouped reservations — the comma rendering, scanned and guarded
// ---------------------------------------------------------------------------

/**
 * The fixture bounds above ($417 / $883) are both under a thousand, so they
 * never exercise the grouped rendering of a reservation. A four-figure bound is
 * where the scan is most delicate: the needle "1,589" must be caught when it is
 * the amount, and must NOT fire inside "$11,589" or "$1,589,000", where the
 * same characters are part of a different number. A guard that got either half
 * wrong would be silently useless — over-tight it leaks, over-loose every
 * render of a large case fails closed.
 */
describe("grouped-thousands reservation", () => {
  const GRAND_RESERVATION = 158_900; // $1,589.00 — B's private ceiling
  const grandCase = () => makeCase({ bPrivate: { reservationCents: GRAND_RESERVATION, notes: NOTES_B } });

  it("catches the grouped dollar rendering", () => {
    expect(violationsOf("They will not go below $1,589 in the end.", grandCase(), "A")).toEqual([
      `reservation amount as "1,589"`,
    ]);
  });

  it("catches the grouped dollar-and-cents rendering", () => {
    expect(violationsOf("$1,589.00 was their real floor.", grandCase(), "A")).toEqual([
      `reservation amount as "1,589.00"`,
    ]);
  });

  it("catches the ungrouped and raw-cents renderings", () => {
    expect(violationsOf("Raw figure 158900 cents appeared on the sheet.", grandCase(), "A")).toEqual([
      `reservation amount as "158900"`,
    ]);
    expect(violationsOf("Their bound is 1589 dollars flat.", grandCase(), "A")).toEqual([
      `reservation amount as "1589"`,
    ]);
  });

  it("does not fire when the same digits sit inside a larger number", () => {
    const rec = grandCase();
    // "1,589" is a substring of both of these, but a digit-adjacent one.
    expect(() => assertNoTaint("The roof invoice was $11,589 for the whole building.", rec, "A")).not.toThrow();
    expect(() =>
      assertNoTaint("Total across the portfolio reached $1,589,000 last year.", rec, "A"),
    ).not.toThrow();
    expect(() => assertNoTaint("Reference 2158900 on the docket.", rec, "A")).not.toThrow();
  });

  it("still renders every legitimate call for a case with a four-figure bound", () => {
    const rec = grandCase();
    for (const variant of RENDER_VARIANTS) {
      for (const callee of PARTIES) {
        const rendered = variant.render(rec, callee);
        expect(rendered.task).not.toContain("1,589");
        expect(rendered.task).not.toContain("158900");
      }
    }
  });
});
