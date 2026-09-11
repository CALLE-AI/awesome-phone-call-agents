import { describe, it, expect } from "vitest";
import { deriveCampaignStatus } from "@/lib/campaign-status";

/**
 * StepReview sent status: "ACTIVE" the instant Launch was pressed, and nothing
 * in the app ever updated a campaign's status again - there is no
 * campaign.update anywhere. So "It's our founder Birthday Month" claimed to be
 * running with nothing booked, no rate confirmed on any call, and would have
 * gone on claiming it forever.
 */
const NOW = new Date(2026, 8, 5); // 5 Sep 2026
const base = {
  storedStatus: "ACTIVE",
  itemStatuses: ["SELECTED", "SELECTED"],
  flightStart: null,
  flightEnd: null,
  now: NOW,
};

describe("what a campaign is actually doing", () => {
  it("is not Active merely because someone pressed Launch", () => {
    const s = deriveCampaignStatus(base);
    expect(s.key).toBe("PLANNED");
    expect(s.label).toBe("Planned");
  });

  it("says how far along the plan is, so the badge is checkable", () => {
    expect(deriveCampaignStatus(base).note).toContain("2 lines planned");
  });

  it("is a Draft when there is no plan at all", () => {
    expect(deriveCampaignStatus({ ...base, itemStatuses: [] }).key).toBe("DRAFT");
  });

  it("becomes Active once a line is booked and the flight is on", () => {
    const s = deriveCampaignStatus({
      ...base,
      itemStatuses: ["BOOKED", "SELECTED"],
      flightStart: new Date(2026, 8, 1),
      flightEnd: new Date(2026, 8, 30),
    });
    expect(s.key).toBe("ACTIVE");
    expect(s.note).toContain("1 of 2 lines booked");
  });

  it("is Scheduled when it is booked but has not started", () => {
    expect(deriveCampaignStatus({
      ...base, itemStatuses: ["BOOKED"],
      flightStart: new Date(2026, 8, 20), flightEnd: new Date(2026, 9, 20),
    }).key).toBe("SCHEDULED");
  });

  it("is Completed once the flight is past", () => {
    expect(deriveCampaignStatus({
      ...base, itemStatuses: ["BOOKED"],
      flightStart: new Date(2026, 7, 1), flightEnd: new Date(2026, 7, 30),
    }).key).toBe("COMPLETED");
  });

  /* A campaign is on air on the last day of its flight, not completed at one
     minute past midnight of a day it is still running. */
  it("is still Active on the final day of the flight", () => {
    expect(deriveCampaignStatus({
      ...base, itemStatuses: ["BOOKED"],
      flightStart: new Date(2026, 7, 1), flightEnd: new Date(2026, 8, 5),
      now: new Date(2026, 8, 5, 23, 59),
    }).key).toBe("ACTIVE");
  });

  it("is Active on the first day, not Scheduled", () => {
    expect(deriveCampaignStatus({
      ...base, itemStatuses: ["BOOKED"],
      flightStart: new Date(2026, 8, 5), flightEnd: new Date(2026, 8, 30),
      now: new Date(2026, 8, 5, 0, 1),
    }).key).toBe("ACTIVE");
  });

  /* Someone decided these. Derivation does not get to argue. */
  it.each(["ARCHIVED", "CANCELLED", "PAUSED"])("keeps a decided status: %s", (stored) => {
    const s = deriveCampaignStatus({ ...base, storedStatus: stored, itemStatuses: ["BOOKED"] });
    expect(s.key).toBe(stored);
  });

  it("does not care what the stored status claims otherwise", () => {
    expect(deriveCampaignStatus({ ...base, storedStatus: "ACTIVE" }).key).toBe("PLANNED");
    expect(deriveCampaignStatus({ ...base, storedStatus: "DRAFT" }).key).toBe("PLANNED");
    expect(deriveCampaignStatus({ ...base, storedStatus: null }).key).toBe("PLANNED");
  });
});
