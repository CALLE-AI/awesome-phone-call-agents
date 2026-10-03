import { describe, expect, it } from "vitest";
import { DEFAULT_LOW_DATA_MODE, parseLowDataMode, shouldAllowManualSync, shouldUseServerRefresh } from "../lib/low-data-preferences";

describe("low-data preferences", () => {
  it("defaults to Wi-Fi-first low-data behavior for missing or malformed storage", () => {
    expect(parseLowDataMode(null)).toEqual(DEFAULT_LOW_DATA_MODE);
    expect(parseLowDataMode("not-json")).toEqual(DEFAULT_LOW_DATA_MODE);
  });

  it("normalizes partial persisted preferences safely", () => {
    expect(parseLowDataMode(JSON.stringify({ enabled: false, manualSyncOnly: true }))).toEqual({ enabled: false, wifiOnly: true, manualSyncOnly: true });
  });

  it("blocks automatic refresh on mobile data, offline, or manual-only mode", () => {
    expect(shouldUseServerRefresh(DEFAULT_LOW_DATA_MODE, true, "CELLULAR")).toBe(false);
    expect(shouldUseServerRefresh(DEFAULT_LOW_DATA_MODE, false, "WIFI")).toBe(false);
    expect(shouldUseServerRefresh({ enabled: true, wifiOnly: true, manualSyncOnly: true }, true, "WIFI")).toBe(false);
    expect(shouldUseServerRefresh(DEFAULT_LOW_DATA_MODE, true, "WIFI")).toBe(true);
  });

  it("allows manual sync only when online or when low-data mode is disabled", () => {
    expect(shouldAllowManualSync(DEFAULT_LOW_DATA_MODE, false)).toBe(false);
    expect(shouldAllowManualSync(DEFAULT_LOW_DATA_MODE, true)).toBe(true);
    expect(shouldAllowManualSync({ enabled: false, wifiOnly: false, manualSyncOnly: false }, false)).toBe(true);
  });
});
