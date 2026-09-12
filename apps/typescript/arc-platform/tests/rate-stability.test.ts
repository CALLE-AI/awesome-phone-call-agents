import { describe, it, expect } from "vitest";
import { rateStability } from "@/lib/rate-stability";
import { needsReview } from "@/lib/call-board";

/**
 * The agent read a rate back digit by digit, got a yes, and the figure went
 * into a field called confirmedRatePkr.
 *
 * The read-back had not failed - it read back the last thing it heard, which is
 * all a read-back can do. The CALL had failed: speech recognition was
 * collapsing throughout ("chocho 500", "video chut 500"), and the caller's rate
 * arrived as 22500, then 500, then 250, then 500, then 1253.
 *
 * The call that worked looks nothing like it: 8000, 8000, 8000, then yes.
 * Neither call carried an estimate, so plausibility() had no opinion on either.
 */
const u = (text: string) => ({ speaker: "user", text });
const b = (text: string) => ({ speaker: "bot", text });

/* Both shapes are taken from the real transcripts. */
const STEADY = [u("available 1500 rupees"), b("say it again?"), u("8000"), b("Just to confirm,"),
                u("8000"), b("Just to confirm,"), u("8000 cricket"),
                b("Is that confirmed as 8 0 0 0 rupees per spot?"), u("yes")];
const COLLAPSING = [u("22500"), b("You said 2 2 5 0 0."), u("chocho 500"), u("Kyon 250"),
                    u("video chut 500"), u("1253"), b("You said 1 2 5 3."), u("yes")];

describe("a figure the caller settled on, versus one that wandered", () => {
  it("trusts a rate said three times", () => {
    const s = rateStability(STEADY, 8000);
    expect(s.repeats).toBe(3);
    expect(s.unstable).toBe(false);
  });

  it("distrusts a rate said once among others", () => {
    const s = rateStability(COLLAPSING, 1253);
    expect(s.repeats).toBe(1);
    expect(s.competing).toEqual(expect.arrayContaining([22500, 500, 250]));
    expect(s.unstable).toBe(true);
  });

  /* The whole point: neither call had an estimate, so the old check passed
     both. */
  it("catches the bad one where the estimate check cannot", () => {
    expect(needsReview(1253, null, COLLAPSING)).toBe(true);
    expect(needsReview(8000, null, STEADY)).toBe(false);
  });

  /* Most callers quote a rate once and confirm it. That is normal and must not
     be flagged - only once-among-many is suspicious. */
  it("does not punish a rate quoted once with nothing competing", () => {
    const clean = [u("it is 7500"), b("You said 7 5 0 0."), u("yes")];
    expect(rateStability(clean, 7500).unstable).toBe(false);
    expect(needsReview(7500, null, clean)).toBe(false);
  });

  it("ignores what the agent says, or every read-back would count as agreement", () => {
    const echo = [u("1253"), b("1253"), b("1253"), b("1253")];
    expect(rateStability(echo, 1253).repeats).toBe(1);
  });

  it("still applies the estimate band when there is one", () => {
    expect(needsReview(80000, 8000, STEADY)).toBe(true);
  });

  it("says nothing useful with no turns, and does not throw", () => {
    expect(rateStability(undefined, 8000).unstable).toBe(false);
    expect(rateStability([], 8000).unstable).toBe(false);
    expect(rateStability(STEADY, null).unstable).toBe(false);
    expect(needsReview(8000, null)).toBe(false);
  });
});
