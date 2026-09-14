import { describe, expect, it } from "vitest";
import { validateFnolResult } from "../src/schemas/fnol.js";
import { validateStatusChaseResult } from "../src/schemas/status-chase.js";

describe("FNOL result schema", () => {
  it("accepts a complete result", () => {
    const out = validateFnolResult({
      incident_type: "auto_collision",
      description: "Rear-ended at a light.",
      injuries: "no",
      damaged_items: ["front bumper"],
      other_party_involved: "yes",
      police_report_filed: "no",
      consent_recorded: true,
    });
    expect(out.valid).toBe(true);
  });

  it("rejects an unknown incident type", () => {
    const out = validateFnolResult({
      incident_type: "meteor_strike",
      description: "x",
      injuries: "no",
      consent_recorded: true,
    });
    expect(out.valid).toBe(false);
  });

  it("rejects missing required fields", () => {
    const out = validateFnolResult({ incident_type: "auto_collision" });
    expect(out.valid).toBe(false);
    expect(out.errors.length).toBeGreaterThan(0);
  });
});

describe("status-chase result schema", () => {
  it("accepts a complete result", () => {
    const out = validateStatusChaseResult({
      work_status: "in_progress",
      eta_date: "2026-09-11",
      estimated_cost_amount: 1850,
      estimated_cost_currency: "USD",
      blockers: "Waiting on a part.",
      contact_name: "Dana",
    });
    expect(out.valid).toBe(true);
  });

  it("accepts nulls for unknown fields", () => {
    const out = validateStatusChaseResult({
      work_status: "unknown",
      eta_date: null,
      estimated_cost_amount: null,
    });
    expect(out.valid).toBe(true);
  });

  it("rejects a bad work_status and malformed date", () => {
    expect(validateStatusChaseResult({ work_status: "maybe" }).valid).toBe(false);
    expect(
      validateStatusChaseResult({ work_status: "in_progress", eta_date: "next friday" }).valid,
    ).toBe(false);
  });
});
