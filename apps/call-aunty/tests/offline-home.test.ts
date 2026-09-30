import { describe, expect, it } from "vitest";
import { offlineClinicGuidance } from "../lib/offline-clinic-guidance";
import { getOfflineHomeCopy } from "../lib/offline-home-copy";

describe("offline Home workflow copy", () => {
  it("provides resume and guidance copy for every supported language", () => {
    for (const language of ["bn", "en", "hi", "ur", "ta", "te"] as const) {
      const copy = getOfflineHomeCopy(language);
      expect(copy.resumeTitle.length).toBeGreaterThan(0);
      expect(copy.resumeBody(2, 4).length).toBeGreaterThan(0);
      expect(copy.guidanceBody.length).toBeGreaterThan(0);
    }
  });

  it("keeps the bundled guidance topics payload-free and actionable", () => {
    expect(offlineClinicGuidance.length).toBeGreaterThanOrEqual(3);
    for (const topic of offlineClinicGuidance) {
      expect(topic.id.length).toBeGreaterThan(0);
      expect(topic.title.length).toBeGreaterThan(0);
      expect(topic.body.length).toBeGreaterThan(0);
    }
  });
});
