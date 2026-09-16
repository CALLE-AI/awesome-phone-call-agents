import { describe, expect, it } from "vitest";
import { statedBloodGroups } from "@/lib/intake";

describe("statedBloodGroups", () => {
  it("reads spelled-out and symbolic groups", () => {
    expect(statedBloodGroups("My father needs 2 units of O negative blood")).toEqual(["O-"]);
    expect(statedBloodGroups("AB+ platelets and B+ve plasma")).toEqual(["AB+", "B+"]);
    expect(statedBloodGroups("looking for A pos donors")).toEqual(["A+"]);
  });

  it("returns nothing when the caregiver did not write a group", () => {
    expect(statedBloodGroups("My father needs blood urgently at the hospital")).toEqual([]);
  });
});
