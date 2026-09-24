import { describe, expect, it } from "vitest";
import { completeFollowUp, validateFollowUp, type FollowUpDraft } from "../lib/follow-up";

const base: FollowUpDraft = { womanId: "Aisha Rahman", contactMethod: "phone", outcome: "reached", note: "Spoke with mother; next visit confirmed.", nextAction: "clinic_visit", status: "draft" };

describe("follow-up workflow", () => {
  it("requires a note when contact is reached", () => {
    expect(validateFollowUp({ ...base, note: "" })).toBe("Add a short note about the contact.");
  });
  it("requires urgent review for clinician escalation", () => {
    expect(validateFollowUp({ ...base, outcome: "needs_clinician", nextAction: "call_again" })).toContain("Clinical review");
  });
  it("marks a valid follow-up completed", () => {
    expect(completeFollowUp(base).status).toBe("completed");
  });
});
