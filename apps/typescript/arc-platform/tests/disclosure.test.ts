import { describe, it, expect } from "vitest";
import { buildTask, buildStandaloneTask, type CallTarget, type CampaignContext } from "@/lib/calle-media";

const station: CallTarget = { name: "City FM 89", type: "station", contactName: "the ad sales desk" };
const creator: CallTarget = { name: "Sana Malik", type: "creator" };
const ctx: CampaignContext = {
  advertiser: "Shan Foods",
  campaignName: "Ramzan Push",
  market: "Karachi",
  flightStart: "2026-09-01",
  flightEnd: "2026-09-30",
};

/**
 * The disclosure is the one instruction with no off switch, so the tests are
 * about reachability as much as wording: every path that can produce a task
 * has to produce one that discloses.
 */
describe("every call identifies itself as an AI", () => {
  it("discloses on a campaign call, before anything is asked", () => {
    const task = buildTask(ctx, station);
    expect(task).toContain("FIRST sentence identifies you as an AI");
    expect(task).toContain("an AI assistant calling on behalf of Shan Foods");
    // Before the questions, not buried after them.
    expect(task.indexOf("AI assistant calling on behalf")).toBeLessThan(
      task.indexOf("the rate per spot")
    );
  });

  it("discloses on a standalone rate enquiry, which has no campaign at all", () => {
    const task = buildStandaloneTask(station);
    expect(task).toContain("FIRST sentence identifies you as an AI");
  });

  it("discloses on creator calls too", () => {
    expect(buildTask(ctx, creator)).toContain("FIRST sentence identifies you as an AI");
  });

  it("never tells the agent it is a person", () => {
    for (const task of [buildTask(ctx, station), buildTask(ctx, creator), buildStandaloneTask(creator)]) {
      expect(task).toContain("Never claim or imply that you are a person");
      expect(task).not.toContain("You are a media buyer for");
    }
  });

  it("gives the other side a way to stop the call", () => {
    const task = buildTask(ctx, station);
    expect(task).toContain("asks you not to call");
    expect(task).toContain("end the call");
  });
});

describe("the result schema can be satisfied by a call that answers no", () => {
  /* A station with no availability has no rate to give. Requiring one meant
     the call could not satisfy its own schema, while the prompt told the agent
     the rate was the most important field and not to end without it - three
     pressures to keep asking a question already answered. */
  it("requires only the yes/no field, not the rate", async () => {
    const { STATION_SCHEMA, CREATOR_SCHEMA } = await import("@/lib/calle-media");
    expect(STATION_SCHEMA.required).toEqual(["available"]);
    expect(CREATOR_SCHEMA.required).toEqual(["interested"]);
  });

  it("still asks for the rate — it is optional, not absent", async () => {
    const { STATION_SCHEMA, CREATOR_SCHEMA } = await import("@/lib/calle-media");
    expect(STATION_SCHEMA.properties).toHaveProperty("rate_per_spot");
    expect(CREATOR_SCHEMA.properties).toHaveProperty("rate");
  });
});
