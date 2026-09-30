import { describe, expect, it } from "vitest";
import { classifyCheckIn } from "../lib/triage";

describe("classifyCheckIn", () => {
  it("routes red-flag symptoms to urgent in-person care", () => {
    expect(classifyCheckIn({ severeBleedingOrPain: true, breathingDifficulty: false, reducedBabyMovement: false, needsHelpScheduling: false })).toBe("urgent_in_person_care");
  });

  it("routes changes or scheduling needs to the CHW", () => {
    expect(classifyCheckIn({ severeBleedingOrPain: false, breathingDifficulty: false, reducedBabyMovement: true, needsHelpScheduling: false })).toBe("contact_chw_today");
    expect(classifyCheckIn({ severeBleedingOrPain: false, breathingDifficulty: false, reducedBabyMovement: false, needsHelpScheduling: true })).toBe("contact_chw_today");
  });

  it("keeps an uncomplicated check-in routine", () => {
    expect(classifyCheckIn({ severeBleedingOrPain: false, breathingDifficulty: false, reducedBabyMovement: false, needsHelpScheduling: false })).toBe("routine");
  });
});
