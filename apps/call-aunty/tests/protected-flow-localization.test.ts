import { describe, expect, it } from "vitest";
import { getSettingsCopy } from "../lib/app-copy";
import { getSecurityCopy } from "../lib/security-copy";

describe("protected-flow localization", () => {
  it("provides localized passcode and lock recovery copy for every supported language", () => {
    for (const language of ["bn", "en", "hi", "ur", "ta", "te"] as const) {
      const settings = getSettingsCopy(language);
      const security = getSecurityCopy(language);
      expect(settings.passcodeMismatch.length).toBeGreaterThan(0);
      expect(settings.passcodeMissing.length).toBeGreaterThan(0);
      expect(security.lockTitle.length).toBeGreaterThan(0);
      expect(security.lockSubtitle.length).toBeGreaterThan(0);
      expect(security.unlock.length).toBeGreaterThan(0);
    }
  });
});
