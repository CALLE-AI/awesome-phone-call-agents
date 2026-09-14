import { describe, it, expect } from "vitest";
import { buildTask, buildStandaloneTask, type CallTarget } from "@/lib/calle-media";

const station: CallTarget = { name: "City FM 89", type: "station" };
const creator: CallTarget = { name: "Sana Malik", type: "creator" };

describe("a call with no campaign does not invent one", () => {
  const task = buildTask({}, station);

  it("never speaks a flight that does not exist", () => {
    // This is what it used to say to a real station.
    expect(task).not.toContain("30-day flight");
    expect(task).not.toContain("within the next two weeks");
    expect(task).not.toContain("during those dates");
  });

  it("never asks the agent to name a campaign there isn't one of", () => {
    expect(task).not.toContain("mention the campaign by name");
    expect(task).not.toContain("our client");
    expect(task).not.toContain("the local market");
  });

  it("says plainly that there is no campaign yet", () => {
    expect(task).toContain("no specific campaign yet");
    expect(task).toContain("rate enquiry");
  });

  it("has an honest answer ready if asked about dates", () => {
    expect(task).toContain("dates are not fixed yet");
  });

  it("keeps the speaking manner that made calls work", () => {
    expect(task).toContain("ONE question at a time");
    // The readback rule moved into NUMBERS and became a gate rather than a
    // manner: money is read back digit by digit and not recorded unconfirmed.
    expect(task).toContain("read the digits back and ask them to confirm");
  });

  it("applies to creators too", () => {
    const c = buildTask({}, creator);
    expect(c).toContain("no specific campaign yet");
    expect(c).toContain("paid collaborations");
    expect(c).not.toContain("30-day flight");
  });
});

describe("a call with a campaign still uses the campaign task", () => {
  const task = buildTask(
    { advertiser: "Shan Foods", campaignName: "Ramzan Push", market: "Karachi",
      flightStart: "2026-09-01", flightEnd: "2026-09-30" }, station);

  it("names the advertiser and the real dates", () => {
    expect(task).toContain("Shan Foods");
    expect(task).toContain("from 2026-09-01 to 2026-09-30");
    expect(task).not.toContain("no specific campaign yet");
  });

  it("a partial context still counts as a campaign", () => {
    expect(buildTask({ advertiser: "Shan Foods" }, station)).toContain("Shan Foods");
  });
});

describe("buildStandaloneTask is callable directly", () => {
  it("differs by target type", () => {
    expect(buildStandaloneTask(station)).toContain("rate per spot");
    expect(buildStandaloneTask(creator)).toContain("deliverables");
  });
});
