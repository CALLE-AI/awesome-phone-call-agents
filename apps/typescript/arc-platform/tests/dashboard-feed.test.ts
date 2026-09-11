import { describe, it, expect } from "vitest";
import { groupFeed, type DashboardCall } from "@/app/dashboard/_components/DashboardHome";

/**
 * Four failed attempts at one station are ONE problem. Rendered as four rows
 * they carry four rows' worth of weight, which overstates them and buries the
 * one call that worked - which was exactly the shape of the real feed.
 */
const call = (o: Partial<DashboardCall> & { targetName: string }): DashboardCall => ({
  calleCallId: `call_${Math.random().toString(36).slice(2)}`,
  outcome: "NOT_CONNECTED", status: "failed", pricePkr: null,
  rateConfirmed: null, createdAt: new Date().toISOString(), done: true,
  ...o,
});

describe("repeated failures at one target collapse into one row", () => {
  it("groups four consecutive failures and keeps the count", () => {
    const feed = groupFeed([
      call({ targetName: "City FM 89" }), call({ targetName: "City FM 89" }),
      call({ targetName: "City FM 89" }), call({ targetName: "City FM 89" }),
    ]);
    expect(feed).toHaveLength(1);
    expect(feed[0].kind).toBe("failures");
    expect(feed[0].calls).toHaveLength(4);
  });

  it("keeps every attempt reachable rather than discarding them", () => {
    // Collapsed, never hidden - the detail is inside the row.
    const feed = groupFeed([call({ targetName: "FM 100" }), call({ targetName: "FM 100" })]);
    expect(feed[0].calls.map((c) => c.calleCallId).filter(Boolean)).toHaveLength(2);
  });

  it("does not merge failures separated by a success", () => {
    // A failure, a success, then another failure is a different story from
    // three in a row, and flattening them would tell it wrong.
    const feed = groupFeed([
      call({ targetName: "City FM 89" }),
      call({ targetName: "City FM 89", outcome: "RESULT", status: "completed", pricePkr: 8000 }),
      call({ targetName: "City FM 89" }),
    ]);
    expect(feed.map((e) => e.kind)).toEqual(["failures", "result", "failures"]);
  });

  it("does not merge different targets", () => {
    const feed = groupFeed([call({ targetName: "City FM 89" }), call({ targetName: "FM 100" })]);
    expect(feed).toHaveLength(2);
  });

  it("marks a call still running as its own entry, never a failure", () => {
    const feed = groupFeed([call({ targetName: "City FM 89", done: false, outcome: null, status: "queued" })]);
    expect(feed[0].kind).toBe("other");
  });

  it("gives a result its own row so it cannot be buried", () => {
    const feed = groupFeed([
      call({ targetName: "City FM 89" }),
      call({ targetName: "City FM 89", outcome: "RESULT", status: "completed", pricePkr: 8000, rateConfirmed: true }),
    ]);
    expect(feed.find((e) => e.kind === "result")?.calls[0].pricePkr).toBe(8000);
  });
});
