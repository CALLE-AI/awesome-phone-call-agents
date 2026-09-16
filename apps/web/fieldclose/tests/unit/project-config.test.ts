import { describe, expect, it } from "vitest";

import { projectConfig } from "@/config/project";

describe("projectConfig", () => {
  it("identifies the focused FieldClose product", () => {
    expect(projectConfig.name).toBe("FieldClose");
    expect(projectConfig.description).toContain("commercial HVAC");
  });

  it("keeps live calls disabled by default", () => {
    expect(projectConfig.liveCallsEnabledByDefault).toBe(false);
  });
});
