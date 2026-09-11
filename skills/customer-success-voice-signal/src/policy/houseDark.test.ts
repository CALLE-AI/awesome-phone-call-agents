import { describe, expect, it } from "vitest";
import { resolveHouseDarkWindow } from "./houseDark.js";
import { enforceHouseDark } from "./shouldRing.js";

describe("resolveHouseDarkWindow", () => {
  it("uses owner 21:00–08:00 America/Chicago when env unset", () => {
    const r = resolveHouseDarkWindow({
      ownerQuietHours: {
        start: "21:00",
        end: "08:00",
        timezone: "America/Chicago",
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("owner");
    expect(r.window).toEqual({
      start: "21:00",
      end: "08:00",
      timezone: "America/Chicago",
    });

    // 07:30 Chicago in CDT (UTC-5 in August) = 12:30 UTC — still house dark for 21–08
    const at0730 = new Date("2026-08-01T12:30:00.000Z");
    expect(enforceHouseDark(at0730, r.window)).toBe(true);

    // 09:00 Chicago = 14:00 UTC — not dark
    const at0900 = new Date("2026-08-01T14:00:00.000Z");
    expect(enforceHouseDark(at0900, r.window)).toBe(false);
  });

  it("complete env override wins over owner window", () => {
    const r = resolveHouseDarkWindow({
      envStart: "22:00",
      envEnd: "07:00",
      envTimezone: "UTC",
      ownerQuietHours: {
        start: "21:00",
        end: "08:00",
        timezone: "America/Chicago",
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("env");
    expect(r.window.start).toBe("22:00");
    expect(r.window.timezone).toBe("UTC");
  });

  it("env override can borrow owner timezone when HOUSE_DARK_TIMEZONE unset", () => {
    const r = resolveHouseDarkWindow({
      envStart: "22:00",
      envEnd: "07:00",
      ownerQuietHours: {
        start: "21:00",
        end: "08:00",
        timezone: "America/Chicago",
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.window.timezone).toBe("America/Chicago");
  });

  it("partial env override fails closed", () => {
    const onlyStart = resolveHouseDarkWindow({
      envStart: "22:00",
      ownerQuietHours: {
        start: "21:00",
        end: "08:00",
        timezone: "America/Chicago",
      },
    });
    expect(onlyStart.ok).toBe(false);

    const onlyEnd = resolveHouseDarkWindow({ envEnd: "07:00" });
    expect(onlyEnd.ok).toBe(false);
  });

  it("defaults to 22:00–07:00 process-local when nothing configured", () => {
    const r = resolveHouseDarkWindow({});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("default");
    expect(r.window).toEqual({ start: "22:00", end: "07:00" });
    expect(r.window.timezone).toBeUndefined();
  });
});
