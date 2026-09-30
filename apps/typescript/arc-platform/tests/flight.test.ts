import { describe, it, expect } from "vitest";
import { flightEndISO, flightEndLabel, toISODate, todayISO, toUTCDate, formatFlightDate } from "@/lib/flight";
import { buildTask } from "@/lib/calle-media";

describe("flight dates", () => {
  it("is inclusive of the start day", () => {
    // A 7-day flight starting Mon 1st runs to Sun 7th, not the 8th.
    expect(flightEndISO("2026-09-01", 7)).toBe("2026-09-07");
    expect(flightEndISO("2026-09-01", 1)).toBe("2026-09-01");
  });

  it("crosses month and year boundaries", () => {
    expect(flightEndISO("2026-08-20", 30)).toBe("2026-09-18");
    expect(flightEndISO("2026-12-20", 30)).toBe("2027-01-18");
  });

  it("handles a leap day", () => {
    expect(flightEndISO("2028-02-27", 3)).toBe("2028-02-29");
  });

  it("returns null rather than a wrong date for bad input", () => {
    expect(flightEndISO("", 30)).toBeNull();
    expect(flightEndISO("not-a-date", 30)).toBeNull();
  });

  it("does not drift a day west of the date line", () => {
    // toISOString() would report the previous day late in the evening in PKT.
    const lateEvening = new Date(2026, 8, 1, 23, 30);
    expect(toISODate(lateEvening)).toBe("2026-09-01");
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("formats the end label", () => {
    expect(flightEndLabel("2026-09-01", 30)).toContain("2026");
    expect(flightEndLabel("", 30)).toBe("—");
  });
});

describe("a flight date is a calendar date", () => {
  it("stores UTC midnight, not local midnight", () => {
    const d = toUTCDate("2026-09-01")!;
    // Local midnight would serialise as the 31st for anyone east of Greenwich.
    expect(d.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("renders the same day it was given, regardless of host timezone", () => {
    expect(formatFlightDate(toUTCDate("2026-09-01")!)).toContain("1 Sep");
    expect(formatFlightDate(toUTCDate("2027-01-18")!)).toContain("18 Jan");
  });

  it("rejects bad input rather than guessing", () => {
    expect(toUTCDate("")).toBeNull();
    expect(toUTCDate("nope")).toBeNull();
  });
});

describe("what CALL-E is told", () => {
  const target = { name: "City FM 89", type: "station" as const };

  it("quotes concrete dates when the brief has them", () => {
    const task = buildTask(
      { advertiser: "Shan", flightStart: "2026-09-01", flightEnd: "2026-09-30" },
      target
    );
    expect(task).toContain("from 2026-09-01 to 2026-09-30");
    expect(task).not.toContain("within the next two weeks");
  });

  it("falls back to the vague phrasing when they are missing", () => {
    const task = buildTask({ advertiser: "Shan" }, target);
    expect(task).toContain("within the next two weeks");
  });
});
