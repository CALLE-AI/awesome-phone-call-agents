import { describe, it, expect } from "vitest";
import { buildMandate, mandatePrompt } from "@/lib/negotiation";
import { buildTask, buildStandaloneTask, schemaFor } from "@/lib/calle-media";

const ctx = {
  advertiser: "Zeb", campaignName: "Eid", market: "Karachi",
  durationDays: 21, budgetTotal: 500_000, currency: "PKR",
};
const station = (estimatePkr: number | null) => ({
  name: "City FM 89", type: "station" as const, estimatePkr,
});

describe("the mandate is built from a rate we actually hold", () => {
  it("opens below the estimate and walks away above it", () => {
    const m = buildMandate({ estimatePkr: 10_000, durationDays: 21, kind: "station" })!;
    expect(m.targetPkr).toBeLessThan(10_000);
    expect(m.walkAwayPkr).toBeGreaterThan(10_000);
  });

  it("has no mandate at all when no rate is on file", () => {
    // Most of the catalogue. A target invented from nothing is the fiction
    // this project keeps removing.
    expect(buildMandate({ estimatePkr: null, kind: "station" })).toBeNull();
    expect(buildMandate({ estimatePkr: 0, kind: "creator" })).toBeNull();
  });

  it("offers a bundle only when there is something to bundle with", () => {
    const alone = buildMandate({ estimatePkr: 9_000, otherLines: 0, kind: "station" })!;
    const withOthers = buildMandate({ estimatePkr: 9_000, otherLines: 4, kind: "station" })!;
    expect(alone.levers.map((l) => l.key)).not.toContain("bundle");
    expect(withOthers.levers.map((l) => l.key)).toContain("bundle");
  });

  it("names the flight length in the volume offer, so it is concrete", () => {
    const m = buildMandate({ estimatePkr: 9_000, durationDays: 21, kind: "station" })!;
    expect(m.levers[0].offer).toContain("3 weeks");
  });
});

describe("the policy the agent is given", () => {
  const m = buildMandate({ estimatePkr: 10_000, durationDays: 21, otherLines: 3, kind: "station" })!;
  const p = mandatePrompt(m);

  it("asks for their rate before naming ours", () => {
    expect(p).toContain("Ask for their rate FIRST");
    expect(p).toContain("never open with a number of your own");
  });

  it("trades a lever for a better price instead of haggling", () => {
    expect(p).toContain("what does that do to the rate");
    expect(p.toLowerCase()).toContain("one thing at a time");
  });

  it("stops after two levers", () => {
    expect(p).toContain("Try at most TWO");
  });

  it("never commits past the walk-away, and closes politely instead", () => {
    expect(p).toContain("NEVER agree to");
    expect(p).toContain("I will need to confirm that internally");
  });

  it("logs each concession separately, not just the final number", () => {
    expect(p).toContain("each one separately");
    expect(p).toContain("the sequence is what we need, not just the last number");
  });
});

/**
 * The gate went in after the first negotiation mandate was pulled, and it
 * worked. Negotiation sits ON TOP of it.
 * These fail if a future edit lets the two blur together.
 */
describe("the confirmation gate is untouched", () => {
  const task = buildTask(ctx, station(10_000));

  it("still refuses to record an unconfirmed rate", () => {
    expect(task).toContain("Do NOT record a rate you have not read back and had confirmed");
    expect(task).toContain("Silence is not a confirmation");
    expect(task).toContain('"OK" is not a confirmation');
  });

  it("still asks for money digit by digit first, not as a fallback", () => {
    expect(task).toContain("FIRST ask them to say it digit by digit");
    expect(task).toContain("Do not save that for when you are confused");
  });

  it("puts the money rules BEFORE the negotiation, not after", () => {
    // Order is load-bearing: hear the number correctly, then push on price.
    expect(task.indexOf("digit by digit")).toBeLessThan(task.indexOf("room to negotiate"));
  });

  it("keeps rate_confirmed in both schemas, mandate or no mandate", () => {
    for (const kind of ["station", "creator"] as const) {
      for (const est of [10_000, null]) {
        const sch = schemaFor({ name: "X", type: kind, estimatePkr: est }, ctx) as {
          properties: Record<string, unknown>;
        };
        expect(sch.properties.rate_confirmed).toBeDefined();
      }
    }
  });

  it("adds negotiation fields without disturbing the required ones", () => {
    const withMandate = schemaFor(station(10_000), ctx) as {
      required: string[]; properties: Record<string, unknown>;
    };
    expect(withMandate.required).toEqual(["available"]);
    expect(withMandate.properties.rate_confirmed).toBeDefined();
    expect(withMandate.properties.concessions).toBeDefined();
    expect(withMandate.properties.opening_rate).toBeDefined();
  });

  it("asks nothing about a negotiation that was never mandated", () => {
    /* One September call had no mandate, so its prompt never
       mentioned negotiating - and the schema asked for opening_rate anyway.
       The model returned 1500: the figure ASR had misheard before the digits
       were read back, plus within_mandate true about a mandate that did not
       exist. A field with no instruction behind it is an invitation. */
    const plain = schemaFor(station(null), ctx) as { properties: Record<string, unknown> };
    expect(plain.properties.opening_rate).toBeUndefined();
    expect(plain.properties.concessions).toBeUndefined();
    expect(plain.properties.within_mandate).toBeUndefined();
    expect(plain.properties.rate_confirmed).toBeDefined();
  });
});

describe("no mandate, no negotiation", () => {
  it("leaves the task a plain enquiry when no rate is on file", () => {
    const task = buildTask(ctx, station(null));
    expect(task).not.toContain("room to negotiate");
    expect(task).toContain("Do NOT record a rate you have not read back and had confirmed");
  });

  it("never negotiates on a standalone call, which has no campaign", () => {
    expect(buildStandaloneTask({ name: "FM 100", type: "station" })).not.toContain("room to negotiate");
  });
});
