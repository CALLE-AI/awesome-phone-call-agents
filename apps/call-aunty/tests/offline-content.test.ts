import { describe, expect, it } from "vitest";
import { getOfflineContentPack, getOfflineContentTopicCount, isOfflineContentAvailable } from "../lib/offline-content";
import { getOfflineContentCopy } from "../lib/offline-content-copy";

describe("offline care content", () => {
  it("provides a bundled core pack for every supported language", () => {
    for (const language of ["bn", "en", "hi", "ur", "ta", "te"] as const) {
      const pack = getOfflineContentPack(language);
      expect(pack.bundled).toBe(true);
      expect(pack.language).toBe(language);
      expect(getOfflineContentTopicCount(language)).toBe(4);
      expect(isOfflineContentAvailable(language, "warning_signs")).toBe(true);
      expect(getOfflineContentCopy(language).detail(4).length).toBeGreaterThan(0);
    }
  });

  it("does not claim unsupported topics are available", () => {
    expect(isOfflineContentAvailable("en", "privacy")).toBe(true);
    expect(isOfflineContentAvailable("en", "unknown" as never)).toBe(false);
  });
});
