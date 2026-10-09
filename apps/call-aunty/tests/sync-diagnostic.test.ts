import { describe, expect, it } from "vitest";
import { formatSyncDiagnostic, normalizeReachability } from "../lib/sync-diagnostic";

const copy = {
  online: "Online",
  offline: "Offline",
  unknown: "Unknown",
  queued: "queued",
  retrying: "retrying",
  synced: "synced",
  exhausted: "need manual retry",
};

describe("sync diagnostic", () => {
  it("normalizes reachable, unavailable, and unknown states", () => {
    expect(normalizeReachability(true)).toBe("online");
    expect(normalizeReachability(false)).toBe("offline");
    expect(normalizeReachability(undefined)).toBe("unknown");
  });

  it("formats queue counts without exposing follow-up payloads", () => {
    expect(formatSyncDiagnostic("online", { queued: 2, retrying: 1, synced: 3, exhausted: 1 }, copy)).toBe("Online\n2 queued · 1 retrying · 3 synced · 1 need manual retry");
  });
});
