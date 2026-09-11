import { describe, expect, it } from "vitest";
import failedVisitsJson from "../examples/failed-visits.json" with { type: "json" };
import type { FailedVisitCase } from "../src/case.js";
import {
  createApprovalReceipt,
  createCallPreview,
  digestPreviewContent,
  isApprovalValid,
  type CallPreviewContent,
} from "../src/preview.js";

const failedVisit = (failedVisitsJson as FailedVisitCase[])[0]!;
const approvedPreview = createCallPreview(failedVisit);
const receipt = createApprovalReceipt(approvedPreview, "test-operator", new Date("2026-08-12T00:00:00Z"));

describe("exact-content approval binding", () => {
  const edits: Array<[string, (content: CallPreviewContent) => void]> = [
    ["case", (content) => { content.caseSnapshot.sourceFailure.summary += " edited"; }],
    ["recipient", (content) => { content.recipient.phoneE164 = "+61491570156"; }],
    ["objective", (content) => { content.objective += " edited"; }],
    ["allowed questions", (content) => { content.allowedQuestions = [...content.allowedQuestions, "An unapproved question?"]; }],
    ["visit windows", (content) => { content.visitWindows[0] = { ...content.visitWindows[0]!, label: "Edited window" }; }],
    ["guardrails", (content) => { content.guardrails = [...content.guardrails, "An unapproved guardrail edit."]; }],
  ];

  it.each(edits)("invalidates approval after an edit to %s", (_name, edit) => {
    const content = structuredClone(approvedPreview.content);
    edit(content);
    expect(isApprovalValid(receipt, { content, digest: digestPreviewContent(content) })).toBe(false);
  });

  it("keeps approval valid only for the exact canonical content", () => {
    expect(isApprovalValid(receipt, createCallPreview(structuredClone(failedVisit)))).toBe(true);
  });
});
