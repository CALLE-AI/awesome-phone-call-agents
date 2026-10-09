import { describe, expect, it } from "vitest";

import { getChwQueueRecord } from "../lib/chw-demo-queue";
import { firstRouteParam } from "../lib/route-params";
import { validateFollowUp, type FollowUpDraft } from "../lib/follow-up";

const base: FollowUpDraft = {
  womanId: "Aisha Rahman",
  contactMethod: "phone",
  outcome: "reached",
  note: "Spoke with mother; next visit confirmed.",
  nextAction: "clinic_visit",
  status: "draft",
};

describe("mobile route and queue guards", () => {
  it("reads the first non-empty Expo Router param", () => {
    expect(firstRouteParam("rina")).toBe("rina");
    expect(firstRouteParam(["", "shahana"])).toBe("shahana");
    expect(firstRouteParam(undefined)).toBe("");
    expect(firstRouteParam(["  "])).toBe("");
  });

  it("does not crash when CHW queue copy is missing an index", () => {
    const record = getChwQueueRecord(
      [{ name: "Rina Begum", meta: "32 weeks", urgency: "Urgent", nextAction: "Call today" }],
      { id: "mousumi" },
      2,
    );
    expect(record.name).toBe("mousumi");
    expect(getChwQueueRecord(undefined, { id: "rina" }, 0).name).toBe("rina");
  });

  it("rejects a follow-up with no woman record before save", () => {
    expect(validateFollowUp({ ...base, womanId: "   " })).toBe("A woman record is required.");
  });
});
