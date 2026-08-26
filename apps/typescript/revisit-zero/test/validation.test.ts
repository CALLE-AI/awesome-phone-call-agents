import { describe, expect, it } from "vitest";
import failedVisitsJson from "../examples/failed-visits.json" with { type: "json" };
import { GOLDEN_RESULT } from "../demo/fake-calle.js";
import type { FailedVisitCase } from "../src/case.js";
import { decideRebookReadiness } from "../src/decision.js";
import type { StructuredCallResult } from "../src/result-schema.js";
import { normalizeProviderStructuredResult } from "../src/result-schema.js";
import { validateStructuredResult } from "../src/validation.js";

const cases = failedVisitsJson as FailedVisitCase[];
const eligible = cases[0]!;

describe("strict closed-result validation and decision", () => {
  it("accepts the golden result and recommends ready for human rebook review", () => {
    const validation = validateStructuredResult(GOLDEN_RESULT, eligible);
    expect(validation.valid).toBe(true);
    expect(decideRebookReadiness(eligible, validation).disposition).toBe("READY_FOR_REBOOK_REVIEW");
  });

  it("turns a resolved versus unresolved blocker into ready versus manual review", () => {
    const unresolved = result({ accessResolution: { ...GOLDEN_RESULT.accessResolution, gateUnlocked: "UNKNOWN" } });
    expect(decideRebookReadiness(eligible, validateStructuredResult(unresolved, eligible)).disposition).toBe("MANUAL_REVIEW");
    expect(decideRebookReadiness(eligible, validateStructuredResult(GOLDEN_RESULT, eligible)).unresolvedFields).toEqual([]);
  });

  it("returns not ready when a documented blocker is unresolved with a negative answer", () => {
    const notReady = result({ accessResolution: { ...GOLDEN_RESULT.accessResolution, dogSecured: "NO" } });
    expect(decideRebookReadiness(eligible, validateStructuredResult(notReady, eligible)).disposition).toBe("NOT_READY");
  });

  it("supports resolved and unresolved external-party access deterministically", () => {
    const external = cases[1]!;
    const resolved = result({
      accessResolution: {
        gateUnlocked: "NOT_APPLICABLE",
        dogSecured: "NOT_APPLICABLE",
        obstructionRemoved: "NOT_APPLICABLE",
        presenceArranged: "NOT_APPLICABLE",
        externalAccessPartyResolved: "YES",
      },
      selectedVisitWindowId: "WED_AM",
    });
    expect(decideRebookReadiness(external, validateStructuredResult(resolved, external)).disposition).toBe("READY_FOR_REBOOK_REVIEW");
    const unknown = result({ ...resolved, accessResolution: { ...resolved.accessResolution, externalAccessPartyResolved: "UNKNOWN" } });
    expect(decideRebookReadiness(external, validateStructuredResult(unknown, external)).disposition).toBe("MANUAL_REVIEW");
  });

  it("rejects malformed results with unknown fields and free-form narratives", () => {
    const malformed = { ...GOLDEN_RESULT, customerNarrative: "My address is ..." };
    const validation = validateStructuredResult(malformed, eligible);
    expect(validation.valid).toBe(false);
    if (!validation.valid) expect(validation.issues.map((issue) => issue.code)).toContain("UNKNOWN_FIELD");
    expect(decideRebookReadiness(eligible, validation).disposition).toBe("MANUAL_REVIEW");
  });

  it("rejects contradictory unreached results containing access answers", () => {
    const contradictory = result({ contactOutcome: "UNREACHED" });
    const validation = validateStructuredResult(contradictory, eligible);
    expect(validation.valid).toBe(false);
    if (!validation.valid) expect(validation.issues.map((issue) => issue.code)).toContain("UNREACHED_WITH_ANSWERS");
    expect(decideRebookReadiness(eligible, validation).disposition).toBe("MANUAL_REVIEW");
  });

  it("rejects the observed live opt-out and contact-outcome contradiction", () => {
    const contradictory = result({ contactOutcome: "REACHED", optOut: true });
    const validation = validateStructuredResult(contradictory, eligible);
    expect(validation.valid).toBe(false);
    if (!validation.valid) expect(validation.issues.map((issue) => issue.code)).toContain("OPT_OUT_OUTCOME_CONFLICT");
    expect(decideRebookReadiness(eligible, validation).disposition).toBe("MANUAL_REVIEW");
  });

  it("normalizes provider NONE but rejects any unapproved provider window string downstream", () => {
    const { optOut: _derivedLocally, ...providerGolden } = GOLDEN_RESULT;
    const none = normalizeProviderStructuredResult({ ...providerGolden, selectedVisitWindowId: "NONE" });
    const normalized = validateStructuredResult(none, eligible);
    expect(normalized.valid).toBe(true);
    if (normalized.valid) {
      expect(normalized.result.selectedVisitWindowId).toBeNull();
      expect(normalized.result.optOut).toBe(false);
    }

    const unapproved = normalizeProviderStructuredResult({ ...providerGolden, selectedVisitWindowId: "FRI_UNAPPROVED" });
    const validation = validateStructuredResult(unapproved, eligible);
    expect(validation.valid).toBe(false);
    if (!validation.valid) expect(validation.issues.map((issue) => issue.code)).toContain("UNAPPROVED_VISIT_WINDOW");
  });

  it("rejects a provider result that adds the removed redundant optOut field", () => {
    const { optOut: _derivedLocally, ...providerGolden } = GOLDEN_RESULT;
    const normalized = normalizeProviderStructuredResult({ ...providerGolden, optOut: true });
    const validation = validateStructuredResult(normalized, eligible);
    expect(validation.valid).toBe(false);
    if (!validation.valid) expect(validation.issues.map((issue) => issue.code)).toEqual(["PROVIDER_WIRE_SCHEMA_MISMATCH"]);
  });
});

function result(overrides: Partial<StructuredCallResult>): StructuredCallResult {
  return { ...structuredClone(GOLDEN_RESULT), ...overrides };
}
