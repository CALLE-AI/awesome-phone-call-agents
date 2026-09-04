import { describe, expect, it } from "vitest";
import failedVisitsJson from "../examples/failed-visits.json" with { type: "json" };
import type { FailedVisitCase } from "../src/case.js";
import { assessPreCall, SuppressionRegistry } from "../src/policy.js";

const cases = failedVisitsJson as FailedVisitCase[];
const eligible = cases[0]!;
const now = new Date("2026-08-12T10:00:00+10:00");

describe("deterministic pre-call policy", () => {
  it("allows the authorized access-only case", () => {
    expect(assessPreCall(eligible, now).decision).toBe("ELIGIBLE_FOR_CALL");
  });

  it("blocks suspected technical or site-safety defects before a call", () => {
    const result = assessPreCall(cases[2]!, now);
    expect(result.decision).toBe("AUTOMATION_BLOCKED");
    expect(result.reasons.map((reason) => reason.code)).toContain("TECHNICAL_OR_SAFETY_DEFECT");
  });

  it("blocks missing authorization", () => {
    const result = assessPreCall(update(eligible, { recipient: { ...eligible.recipient, authorized: false } }), now);
    expect(result.decision).toBe("AUTOMATION_BLOCKED");
    expect(result.reasons[0]?.code).toBe("MISSING_AUTHORIZATION");
  });

  it("closes an expired call window", () => {
    const result = assessPreCall(update(eligible, { callWindow: { start: "2026-01-01T00:00:00Z", end: "2026-01-01T01:00:00Z" } }), now);
    expect(result.decision).toBe("CALL_WINDOW_CLOSED");
    expect(result.reasons[0]?.code).toBe("CALL_WINDOW_EXPIRED");
  });

  it("blocks an invalid E.164 recipient", () => {
    const result = assessPreCall(update(eligible, { recipient: { ...eligible.recipient, phoneE164: "0412 345 678" } }), now);
    expect(result.decision).toBe("AUTOMATION_BLOCKED");
    expect(result.reasons[0]?.code).toBe("INVALID_E164");
  });

  it("routes external access control to manual review without calling that party", () => {
    const result = assessPreCall(cases[1]!, now);
    expect(result.decision).toBe("MANUAL_REVIEW_REQUIRED");
    expect(result.reasons[0]?.code).toBe("EXTERNAL_ACCESS_PARTY");
  });

  it("blocks a recipient after opt-out suppression", () => {
    const suppressions = new SuppressionRegistry();
    suppressions.suppress(eligible.recipient.phoneE164);
    expect(assessPreCall(eligible, now, suppressions).reasons[0]?.code).toBe("CONTACT_SUPPRESSED");
  });
});

function update(failedVisit: FailedVisitCase, fields: Partial<FailedVisitCase>): FailedVisitCase {
  return { ...structuredClone(failedVisit), ...fields };
}
