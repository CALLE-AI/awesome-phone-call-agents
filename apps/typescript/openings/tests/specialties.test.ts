import { describe, expect, it } from "vitest";
import {
  SPECIALTIES,
  SPECIALTY_IDS,
  getSpecialty,
  isSpecialtyId,
  specialtyLabel,
  taxonomyFor,
} from "../src/core/specialties";

describe("specialties catalog", () => {
  it("has unique ids", () => {
    const ids = SPECIALTIES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("exposes a non-empty tuple of ids for the validation enum", () => {
    expect(SPECIALTY_IDS.length).toBeGreaterThan(0);
  });

  it("looks up a specialty by id", () => {
    expect(getSpecialty("psychiatry")?.taxonomy).toBe("Psychiatry");
    expect(getSpecialty("dentist")?.taxonomy).toBe("Dentist");
    expect(getSpecialty("nope")).toBeNull();
  });

  it("guards unknown ids rather than guessing a taxonomy", () => {
    expect(isSpecialtyId("psychiatry")).toBe(true);
    expect(isSpecialtyId("nope")).toBe(false);
    expect(() => taxonomyFor("nope")).toThrow("unknown_specialty:nope");
  });

  it("labels unknown ids with the raw id so old watches still render", () => {
    expect(specialtyLabel("psychiatry")).toBe("Psychiatry");
    expect(specialtyLabel("obsolete-id")).toBe("obsolete-id");
  });
});
