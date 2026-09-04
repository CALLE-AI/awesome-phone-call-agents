import { describe, expect, it } from "vitest";

import {
  createNewCaseWorkOrderReference,
  formatDateInTimezone,
  PRESET_DEMO_WORK_ORDER,
} from "@/components/new-case-form";

describe("new case form defaults", () => {
  it("keeps the demo work order fixed and explicitly fictional", () => {
    expect(createNewCaseWorkOrderReference("fake")).toBe("WO-DEMO-1042");
    expect(PRESET_DEMO_WORK_ORDER).toMatchObject({
      contractorDisplayName: "Example HVAC",
      siteLabel: "Fictional North Store",
      phoneE164: "+12025550142",
      serviceDate: "2026-07-27",
      timezone: "America/Chicago",
    });
    expect(PRESET_DEMO_WORK_ORDER.requestedFields).toEqual([
      "observed_operating_status",
      "unresolved_issue",
      "return_visit_request",
    ]);
  });

  it("generates a bounded random reference only for live cases", () => {
    const first = createNewCaseWorkOrderReference("live");
    const second = createNewCaseWorkOrderReference("live");

    expect(first).toMatch(/^WO-LIVE-[A-F0-9]{8}$/u);
    expect(second).toMatch(/^WO-LIVE-[A-F0-9]{8}$/u);
    expect(second).not.toBe(first);
  });

  it("derives the calendar date from the selected IANA timezone", () => {
    const utcBoundary = new Date("2026-01-01T00:30:00.000Z");
    const positiveOffsetBoundary = new Date("2026-01-01T23:30:00.000Z");

    expect(formatDateInTimezone(utcBoundary, "America/Los_Angeles")).toBe(
      "2025-12-31",
    );
    expect(formatDateInTimezone(positiveOffsetBoundary, "Asia/Shanghai")).toBe(
      "2026-01-02",
    );
  });
});
