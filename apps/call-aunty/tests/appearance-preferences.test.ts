import { describe, expect, it } from "vitest";
import { parseAppearancePreference } from "../lib/appearance-preferences";

describe("appearance preference", () => {
  it("accepts light and dark values", () => {
    expect(parseAppearancePreference("light")).toBe("light");
    expect(parseAppearancePreference("dark")).toBe("dark");
  });

  it("rejects unknown values", () => {
    expect(parseAppearancePreference(null)).toBeNull();
    expect(parseAppearancePreference("system")).toBeNull();
  });
});
