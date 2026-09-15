// The measured number. Runs the zero-cost harness over every fixture call in the demo
// set and asserts the two invariants we publish: zero false verifications under six
// adversarial mutations, and full recall on answers the other party actually stated.
// `npm run eval` prints the report.

import { describe, expect, it } from "vitest";
import { runEval, summarize, MUTATIONS, type EvalCase } from "../src/core/eval";
import { scenarios, batchScenarios } from "../src/scenarios";
import { verticals, batchPresets } from "../src/goals";

function cases(): EvalCase[] {
  const out: EvalCase[] = [];
  for (const v of verticals) {
    for (const p of v.presets) {
      const result = scenarios[p.scenarioId];
      if (result) out.push({ id: `${v.id}/${p.id}`, requestedKeys: p.requestedKeys, result });
    }
  }
  for (const b of batchPresets) {
    for (const r of b.recipients) {
      const result = batchScenarios[r.scenarioId];
      if (result) out.push({ id: `${b.id}/${r.id}`, requestedKeys: b.requestedKeys, result });
    }
  }
  return out;
}

describe("verified-phone-outcome evaluation harness (no calls placed)", () => {
  const report = runEval(cases());

  it("covers the whole demo fixture set with every mutation", () => {
    expect(report.fixtures).toBeGreaterThanOrEqual(9);
    expect(report.mutations).toBe(report.fixtures * MUTATIONS.length);
    for (const m of MUTATIONS) expect(report.byMutation[m].fields).toBeGreaterThan(0);
  });

  it("never verifies a field after any adversarial mutation", () => {
    expect(report.falseVerifications).toBe(0);
  });

  it("every verified field cites a verbatim turn spoken by the other party", () => {
    expect(report.unsoundVerifications).toBe(0);
  });

  it("marks verified every answer the other party actually stated", () => {
    expect(report.groundedInFixtures).toBeGreaterThan(0);
    expect(report.groundedRecalled).toBe(report.groundedInFixtures);
  });

  it("reports the within-sentence swap limitation honestly (diagnostic, not a gate)", () => {
    expect(report.swapDiagnostic.swappedFields).toBeGreaterThan(0);
    expect(report.swapDiagnostic.swapsCaught).toBeLessThanOrEqual(report.swapDiagnostic.swappedFields);
  });

  it("prints the publishable summary", () => {
    const line = summarize(report);
    console.log("\nEVAL: " + line + "\n");
    expect(line).toContain("0 false verifications");
  });
});
