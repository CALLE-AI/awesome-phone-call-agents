import { describe, it, expect } from "vitest";

/**
 * The LOAD_STATE guard. A brief saved before startDate existed must rehydrate
 * with the default rather than undefined - an undefined value reaching a date
 * input is what this guards against, and there are real briefs in localStorage
 * from before the field was added.
 */
const INITIAL_BRIEF = { productName: "", startDate: "", duration: 30 as const, totalBudget: 0 };
const INITIAL_STATE = { step: "brief", brief: INITIAL_BRIEF, selections: { selectedScriptIds: [] } };

function loadState(saved: Record<string, unknown>) {
  return {
    ...INITIAL_STATE,
    ...saved,
    brief: { ...INITIAL_BRIEF, ...((saved?.brief as object) ?? {}) },
    selections: { ...INITIAL_STATE.selections, ...((saved?.selections as object) ?? {}) },
  };
}

describe("wizard rehydrate", () => {
  it("fills startDate for a brief saved before the field existed", () => {
    const old = { step: "brief", brief: { productName: "Herbion", duration: 30, totalBudget: 50000 } };
    const next = loadState(old);
    expect(next.brief.startDate).toBe("");
    expect(next.brief.startDate).not.toBeUndefined();
    expect(next.brief.productName).toBe("Herbion"); // real answers survive
  });

  it("keeps a saved startDate", () => {
    const next = loadState({ brief: { startDate: "2026-09-01" } });
    expect(next.brief.startDate).toBe("2026-09-01");
  });

  it("survives a brief key missing entirely", () => {
    expect(loadState({ step: "scripts" }).brief.startDate).toBe("");
  });
});
