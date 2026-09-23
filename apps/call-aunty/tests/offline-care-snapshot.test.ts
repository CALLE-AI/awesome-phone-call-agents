import { describe, expect, it } from "vitest";
import { getOfflineCareFreshness, OFFLINE_CARE_SNAPSHOT_MAX_AGE_MS, parseOfflineCareSnapshot } from "../lib/offline-care-snapshot";
import { getOfflineCareMessage } from "../lib/offline-care-copy";

describe("offline care snapshot", () => {
  it("rejects missing, malformed, and invalid timestamps safely", () => {
    expect(parseOfflineCareSnapshot(null)).toBeNull();
    expect(parseOfflineCareSnapshot("not-json")).toBeNull();
    expect(parseOfflineCareSnapshot(JSON.stringify({ language: "en", savedAt: "bad", version: "1" }))).toBeNull();
  });

  it("classifies available and stale snapshots by a bounded freshness window", () => {
    const now = Date.parse("2026-08-18T12:00:00.000Z");
    const snapshot = { language: "en" as const, savedAt: new Date(now - OFFLINE_CARE_SNAPSHOT_MAX_AGE_MS + 1).toISOString(), version: "2026.08" };
    expect(getOfflineCareFreshness(snapshot, now)).toBe("available");
    expect(getOfflineCareFreshness({ ...snapshot, savedAt: new Date(now - OFFLINE_CARE_SNAPSHOT_MAX_AGE_MS - 1).toISOString() }, now)).toBe("stale");
    expect(getOfflineCareFreshness(null, now)).toBe("missing");
  });

  it("provides localized fallback guidance", () => {
    for (const language of ["bn", "en", "hi", "ur", "ta", "te"] as const) {
      expect(getOfflineCareMessage(language, "missing").length).toBeGreaterThan(0);
      expect(getOfflineCareMessage(language, "stale").length).toBeGreaterThan(0);
    }
  });
});
