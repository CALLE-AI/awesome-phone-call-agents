import { describe, it, expect } from "vitest";
import { buildTask, type CallTarget } from "@/lib/calle-media";

const station: CallTarget = { name: "City FM 89", type: "station", contactName: "the ad sales desk" };
const creator: CallTarget = { name: "Sana Malik", type: "creator" };
const ctx = { advertiser: "Shan Foods", campaignName: "Ramzan Push", market: "Karachi",
  flightStart: "2026-09-01", flightEnd: "2026-09-30" };

describe("the call task instructs how to speak, not just what to ask", () => {
  const task = buildTask(ctx, station);

  it("asks one question at a time", () => {
    expect(task).toContain("ONE question at a time");
    expect(task).toContain("never list several questions in one turn");
  });

  it("requires numbers to be read back", () => {
    // The 31-turn call heard "2020 2030" for a rate and never checked it.
    expect(task).toContain("read the digits back and ask them to confirm");
    expect(task).toContain("digit by digit");
    // Not a fallback for confusion any more: ASR failure feels like certainty,
    // so a rule that fires on not-understanding never fires when it matters.
    expect(task).toContain("Do not save that for when you are confused");
  });

  it("opens with one short sentence rather than the whole brief", () => {
    // Wording moved when the AI disclosure took the opening turn: the brief is
    // still not the first thing said, it is just no longer the first
    // instruction either.
    /* Was "Then say in one short sentence ... and ask if you have reached
       <contact>". The qualifying question is gone - it was the thing the agent
       looped on - so the opening is one sentence that states the purpose and
       moves on. */
    expect(task).toContain("Then, in ONE sentence, say you are calling about radio advertising");
    /* "Only once they have engaged" is deleted, not reworded: it made every
       later question conditional on a check a noisy line can never satisfy,
       which is the loop. */
    expect(task).not.toContain("Only once they have engaged");
  });

  it("names the rate as the thing not to leave without", () => {
    expect(task).toContain("do not end the call without it");
  });

  it("still carries the campaign's real details and dates", () => {
    expect(task).toContain("Shan Foods");
    expect(task).toContain("from 2026-09-01 to 2026-09-30");
  });

  it("applies the same manner to creator calls", () => {
    const c = buildTask(ctx, creator);
    expect(c).toContain("ONE question at a time");
    expect(c).toContain("read the digits back and ask them to confirm");
    expect(c).toContain("do not end the call without it");
  });
});

describe("a question is asked a bounded number of times", () => {
  /* On 1 Sep a connected call asked for the audience size five times and
     "Anything else to add?" six times, ending only when the recipient fell
     silent. Persistence with no ceiling is a loop. */
  const variants: [string, string][] = [
    ["campaign station", buildTask(ctx, station)],
    ["campaign creator", buildTask(ctx, creator)],
    ["standalone station", buildTask({}, station)],
    ["standalone creator", buildTask({}, creator)],
  ];

  for (const [name, task] of variants) {
    it(`stops re-asking after two attempts — ${name}`, () => {
      expect(task).toContain("at most twice");
      expect(task).toContain("note it as not confirmed");
    });

    it(`closes the call once rather than looping on the wrap-up — ${name}`, () => {
      expect(task).toContain("ask ONCE whether there is anything else");
      expect(task).toContain("do not ask it a second");
    });
  }
});

describe("a rate is recorded with what it buys", () => {
  /* `rate: 8000` was true and useless: it was a creator's story price while
     the post price was 18,000, and the UI rendered it under a hardcoded
     "per post". One scalar cannot hold two prices - this does not fix that,
     it stops the omission being silent. */
  it("asks what the rate covers, on every variant", () => {
    for (const task of [
      buildTask(ctx, station), buildTask(ctx, creator),
      buildTask({}, station), buildTask({}, creator),
    ]) {
      expect(task).toContain("what that rate covers");
      expect(task).toContain("say in your notes what the others were");
    }
  });

  it("carries the basis through to the scored row", async () => {
    const { scoreRow } = await import("@/lib/calle-media");
    const row = scoreRow({}, creator, { interested: "yes", rate: 8000, rate_basis: "per 24-hour story" });
    expect(row.price).toBe(8000);
    expect(row.rateBasis).toBe("per 24-hour story");
  });

  it("leaves the basis empty rather than guessing when they did not say", async () => {
    const { scoreRow } = await import("@/lib/calle-media");
    expect(scoreRow({}, creator, { interested: "yes", rate: 8000 }).rateBasis).toBe("");
  });
});

describe("a rate is not recorded unless they confirmed it", () => {
  /* The old rule asked the agent to repeat numbers back. On 1 Sep it skipped
     the readback for the rate entirely - CALL-E's own evidence array said so -
     and the misheard figure was recorded as fact. Repeating a number back was
     a behaviour with no consequence for skipping it. */
  const variants = [
    buildTask(ctx, station), buildTask(ctx, creator),
    buildTask({}, station), buildTask({}, creator),
  ];

  it("asks for money digit by digit first, not as a fallback", () => {
    for (const task of variants) {
      expect(task).toContain("FIRST ask them to say it digit by digit");
      expect(task).toContain("Do not save that for when you are confused");
    }
  });

  it("forbids recording an unconfirmed rate", () => {
    for (const task of variants) {
      expect(task).toContain("Do NOT record a rate you have not read back and had confirmed");
    }
  });

  it("says what does not count as a confirmation", () => {
    for (const task of variants) {
      expect(task).toContain("Silence is not a confirmation");
      expect(task).toContain("moving on to another subject is not a confirmation");
    }
  });

  it("carries the confirmation through to the row, and does not invent one", async () => {
    const { scoreRow } = await import("@/lib/calle-media");
    expect(scoreRow({}, creator, { interested: "yes", rate: 8000, rate_confirmed: true }).rateConfirmed).toBe(true);
    expect(scoreRow({}, creator, { interested: "yes", rate: 8000, rate_confirmed: false }).rateConfirmed).toBe(false);
    // Absent is null, not false: "the call did not say" is not "they refused".
    expect(scoreRow({}, creator, { interested: "yes", rate: 8000 }).rateConfirmed).toBeNull();
  });
});
