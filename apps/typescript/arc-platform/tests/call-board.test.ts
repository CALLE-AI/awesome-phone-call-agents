import { describe, it, expect } from "vitest";
import {
  phaseOf, phaseLabel, findConfirmation, fieldsSoFar, negotiationOf,
  plausibility, needsReview,
  type CallSnapshot,
} from "@/lib/call-board";
import replay from "@/app/dev/callboard/_replay.json";

/* Three SYNTHETIC calls. These were captured from CALL-E once and were real,
   and the real ones are gone: a cold call's transcript is a recording of
   somebody who never agreed to be published, and this repository is public.

   What survives is the shape, because that is what the board is tested on -
   a read-back that settles after an earlier one did not, a confirmed rate
   that cannot be right, and a call nobody answered. Every property asserted
   below was preserved deliberately when the samples were written. The real
   archives are kept privately. */
const snap = (i: number): CallSnapshot => {
  const r = replay[i] as unknown as CallSnapshot & { structuredResult: Record<string, unknown> | null };
  return { ...r, turns: r.turns ?? [] };
};
const withReadback = snap(1);   // two asks; the second is the one agreed
const longCall = snap(0);       // settles on 1,253 - confirmed and implausible
const neverConnected = snap(2); // SIP 486, no turns at all

describe("the card's state, in words a room can read", () => {
  it("calls a finished call completed and a 486 did-not-connect", () => {
    expect(phaseOf(withReadback)).toBe("completed");
    expect(phaseLabel(phaseOf(neverConnected))).toBe("Did not connect");
  });

  it("is in conversation once there are turns", () => {
    expect(phaseOf({ ...withReadback, status: "in_progress" })).toBe("in conversation");
  });

  it("is ringing before anyone speaks, dialling before that", () => {
    expect(phaseOf({ ...withReadback, status: "in_progress", turns: [] })).toBe("ringing");
    expect(phaseOf({ ...withReadback, status: "queued", turns: [] })).toBe("dialling");
  });

  it("treats an unanswered status read as waiting, never as failure", () => {
    // The queue has run well past an hour. A card that calls that an error
    // tells the room the system broke when it is only waiting.
    const s = { ...withReadback, status: "queued", turns: [], unreachable: true };
    expect(phaseOf(s)).toBe("waiting");
    expect(phaseLabel(phaseOf(s))).toBe("Waiting for CALL-E");
    expect(phaseLabel(phaseOf(s)).toLowerCase()).not.toContain("timeout");
  });
});

describe("the confirmation moment is found, not left to be spotted", () => {
  it("finds the digits read back and the yes that followed", () => {
    const c = findConfirmation(withReadback.turns)!;
    expect(c.spoken).toBe("8 0 0 0");
    expect(c.value).toBe(8000);
    expect(withReadback.turns[c.askIndex].text).toMatch(/confirm/i);
    expect(withReadback.turns[c.yesIndex].text.trim()).toMatch(/^yes/i);
  });

  it("takes the ask the yes actually followed, not the first one", () => {
    // On this sample the agent reads back 1 5 0 0, is told that is the old
    // rate card, asks again, reads back 8 0 0 0, and only THAT ask earns a
    // yes. The real call this replaced failed the same way for a worse
    // reason - two mis-transcriptions in a row - which is why the rule is
    // "the ask the yes followed", not "the first ask".
    const c = findConfirmation(withReadback.turns)!;
    /* CALL-E splits a sentence across turns ("Sorry," / "I'm asking..."), so
       bot turns between the two are normal. What must NOT be between them is
       another confirmation ask - that would mean the yes was attached to the
       wrong question. */
    const between = withReadback.turns.slice(c.askIndex + 1, c.yesIndex);
    const laterAsks = between.filter(
      (t) => t.speaker === "bot" && /\d(\s+\d){2,}/.test(t.text) && /confirm|is that/i.test(t.text)
    );
    expect(laterAsks).toEqual([]);
  });

  it("finds it on the other call too", () => {
    const c = findConfirmation(longCall.turns)!;
    expect(c.value).toBe(1253);
  });

  it("finds nothing on a call nobody answered", () => {
    expect(findConfirmation(neverConnected.turns)).toBeNull();
  });
});

describe("fields appear as they are learned", () => {
  it("marks a rate confirmed only when it was read back and agreed", () => {
    const rate = fieldsSoFar(withReadback).find((f) => f.key === "rate")!;
    expect(rate.value).toContain("8,000");
    expect(rate.confirmed).toBe(true);
    expect(rate.heardAt).not.toBeNull();
  });

  it("shows a rate from the transcript before the result exists", () => {
    // Mid-call there is no structured result yet, and waiting for one is
    // exactly the all-at-the-end behaviour the board is replacing.
    const mid = { ...withReadback, status: "in_progress", structuredResult: null };
    const rate = fieldsSoFar(mid).find((f) => f.key === "rate");
    expect(rate?.value).toContain("8,000");
  });

  it("shows no rate for a call that never connected", () => {
    // 0 turns, SIP 486. Nothing was heard, so nothing may be quoted.
    expect(fieldsSoFar(neverConnected).find((f) => f.key === "rate")).toBeUndefined();
    expect(findConfirmation(neverConnected.turns)).toBeNull();
  });
});

describe("the negotiation panel", () => {
  it("stays hidden when there was no mandate", () => {
    /* This call HAS an opening_rate in its result - 1500, which the model
       invented because the schema asked while the prompt never mentioned
       negotiating. Without a mandate the panel must not render it. */
    expect(withReadback.structuredResult?.opening_rate).toBe(1500);
    expect(negotiationOf(withReadback)).toBeNull();
  });

  it("shows target, walk-away and agreed together when the CALL carried one", () => {
    const n = negotiationOf({ ...withReadback, mandate: { targetPkr: 7000, walkAwayPkr: 9000 } })!;
    expect(n.target).toBe(7000);
    expect(n.walkAway).toBe(9000);
    expect(n.agreed).toBe(8000);
  });
});

/**
 * Confirmed is not the same as believed. On the 120-turn replay the readback
 * worked perfectly and produced PKR 1,253 per spot for a station we estimate
 * at 8,000. Both are true: they did agree to 1,253, and 1,253 cannot be right.
 * This layer sits ON TOP of the gate and never touches it.
 */
describe("a confirmed rate is still checked for plausibility", () => {
  it("flags a rate far below the estimate", () => {
    const p = plausibility(1253, 8000);
    expect(p.kind).toBe("out-of-range");
    expect(needsReview(1253, 8000)).toBe(true);
  });

  it("flags a rate far above it too", () => {
    expect(needsReview(20_000, 8000)).toBe(true);
  });

  it("accepts a rate that is merely different", () => {
    // Rates vary by daypart and package. Half to double catches wrong, not
    // different - 6,000 and 12,000 against 8,000 are both honest numbers.
    expect(needsReview(6000, 8000)).toBe(false);
    expect(needsReview(12_000, 8000)).toBe(false);
  });

  it("has no opinion when we hold no estimate", () => {
    // Most of the catalogue. Inventing a range to judge against would be the
    // same fiction we keep removing.
    expect(plausibility(1253, null).kind).toBe("no-estimate");
    expect(needsReview(1253, null)).toBe(false);
    expect(needsReview(1253, 0)).toBe(false);
  });

  it("says so on the rate field itself", () => {
    const withEstimate = { ...longCall, estimatePkr: 8000 };
    const rate = fieldsSoFar(withEstimate).find((f) => f.key === "rate")!;
    expect(rate.confirmed).toBe(true);
    expect(rate.plausibility?.kind).toBe("out-of-range");
  });
});

describe("a card shows only the mandate its own call carried", () => {
  it("shows no price panel for a call placed before mandates existed", () => {
    // This one was showing Target 7,000 / Walk-away 9,000 - numbers it was
    // never given, read from today's catalogue.
    expect(longCall.mandate ?? null).toBeNull();
    expect(negotiationOf(longCall)).toBeNull();
  });

  it("shows the panel when the call itself carried a mandate", () => {
    const withMandate = { ...longCall, mandate: { targetPkr: 7000, walkAwayPkr: 9000 } };
    expect(negotiationOf(withMandate)?.target).toBe(7000);
  });
});
