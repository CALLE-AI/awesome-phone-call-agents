import { describe, expect, it } from "vitest";

import { DEMO_QUEUE, getChwQueueRecord } from "../lib/demo-queue";
import {
  awaitingCallbackCount,
  consentHoldCount,
  countByTone,
  filterHouseholds,
  getHousehold,
  getHouseholdQueueCopy,
  householdName,
  householdsByRoute,
  mockCallLog,
  MOCK_HOUSEHOLDS,
  safetyReviewCount,
} from "../lib/mock-households";
import { getDemoBeneficiary } from "../server/calle/demo-data";
import { selectMockScenario } from "../server/calle/mock";

describe("mock household mobile dataset", () => {
  it("keeps the original three queue ids and expands the field roster", () => {
    expect(MOCK_HOUSEHOLDS.map((item) => item.id).slice(0, 3)).toEqual(["rina", "shahana", "mousumi"]);
    expect(MOCK_HOUSEHOLDS.length).toBe(12);
    expect(DEMO_QUEUE).toHaveLength(12);
    expect(DEMO_QUEUE[0]).toEqual({ id: "rina", tone: "urgent" });
    expect(countByTone("urgent")).toBeGreaterThanOrEqual(3);
    expect(awaitingCallbackCount()).toBeGreaterThan(0);
    expect(safetyReviewCount()).toBeGreaterThan(0);
    expect(consentHoldCount()).toBe(1);
  });

  it("localizes queue copy without dropping English fallbacks", () => {
    const english = getHouseholdQueueCopy("en");
    const bangla = getHouseholdQueueCopy("bn");
    expect(english[0]).toMatchObject({
      name: "Rina Begum",
      meta: "32 weeks · check-in missed",
      urgency: "Urgent",
      nextAction: "Call today",
    });
    expect(bangla[0].name).toBe("রিনা বেগম");
    expect(bangla[0].meta).not.toBe(english[0].meta);
    expect(householdName(MOCK_HOUSEHOLDS[3], "hi")).toBe("फरहाना इस्लाम");
  });

  it("filters by tone and searches name or village", () => {
    expect(filterHouseholds("en", { tone: "urgent" }).every((item) => item.tone === "urgent")).toBe(true);
    expect(filterHouseholds("en", { query: "korail" }).map((item) => item.id)).toEqual(["rina"]);
    expect(filterHouseholds("bn", { query: "ফারহানা" })[0]?.id).toBe("farhana");
    expect(filterHouseholds("en", { tone: "routine", query: "zzz" })).toHaveLength(0);
  });

  it("orders the field route and exposes a mock CALL-E log", () => {
    const route = householdsByRoute();
    expect(route[0].routeOrder).toBe(1);
    expect(route.map((item) => item.routeOrder)).toEqual([...route.map((item) => item.routeOrder)].sort((a, b) => a - b));
    expect(mockCallLog().every((row) => row.event.channel === "call-e" || row.event.channel === "missed")).toBe(true);
    expect(getHousehold("Farhana Islam")?.id).toBe("farhana");
  });

  it("uses only masked synthetic phones", () => {
    for (const household of MOCK_HOUSEHOLDS) {
      expect(household.maskedPhone).toContain("•");
      expect(household.maskedPhone).not.toMatch(/\d{7,}/);
      expect(getDemoBeneficiary(household.beneficiaryId)?.demoE164.startsWith("+1555555")).toBe(true);
    }
  });

  it("keeps getChwQueueRecord resilient when copy is short", () => {
    expect(
      getChwQueueRecord(
        [{ name: "Rina Begum", meta: "32 weeks", urgency: "Urgent", nextAction: "Call today" }],
        { id: "mousumi" },
        2,
      ).name,
    ).toBe("Rina Begum");
  });
});

describe("expanded CALL-E mock scenarios", () => {
  it("selects voicemail and safety fixtures from task text", () => {
    expect(selectMockScenario("Leave a voicemail and wait")).toBe("voicemail");
    expect(selectMockScenario("Run the safety script after distress")).toBe("safety_escalation");
  });
});
