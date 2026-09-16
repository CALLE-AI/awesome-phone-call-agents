import { describe, expect, it } from "vitest";
import failedVisitsJson from "../examples/failed-visits.json" with { type: "json" };
import { FakeCalleTransport, GOLDEN_RESULT } from "../demo/fake-calle.js";
import type { FailedVisitCase } from "../src/case.js";
import { createApprovalReceipt } from "../src/preview.js";
import type { StructuredCallResult } from "../src/result-schema.js";
import { decideLocalExport, RevisitZeroWorkflow } from "../src/workflow.js";

const cases = failedVisitsJson as FailedVisitCase[];
const eligible = cases[0]!;
const now = new Date("2026-08-12T10:00:00+10:00");

describe("one-call workflow", () => {
  it("completes all three demo cases with exactly one fake call", async () => {
    const transport = new FakeCalleTransport();
    const workflow = new RevisitZeroWorkflow(transport);
    const dispositions: string[] = [];
    for (const failedVisit of cases) {
      const prepared = workflow.prepare(failedVisit, now);
      const approval = prepared.preview ? createApprovalReceipt(prepared.preview, "tester", now) : null;
      dispositions.push((await workflow.execute(failedVisit, approval, { now })).disposition);
    }
    expect(dispositions).toEqual(["READY_FOR_REBOOK_REVIEW", "MANUAL_REVIEW", "AUTOMATION_BLOCKED"]);
    expect(transport.invocations).toHaveLength(1);
  });

  it("invalidates approval after any case or allowed-content edit", async () => {
    const transport = new FakeCalleTransport();
    const workflow = new RevisitZeroWorkflow(transport);
    const preview = workflow.prepare(eligible, now).preview!;
    const approval = createApprovalReceipt(preview, "tester", now);
    const edited = { ...structuredClone(eligible), visitWindows: eligible.visitWindows.map((window, index) => index === 0 ? { ...window, label: `${window.label} edited` } : window) };
    const run = await workflow.execute(edited, approval, { now });
    expect(run.approvalState).toBe("INVALIDATED");
    expect(run.disposition).toBe("AUTOMATION_BLOCKED");
    expect(transport.invocations).toHaveLength(0);
  });

  it("prevents duplicate provider calls with the stable idempotency key", async () => {
    const transport = new FakeCalleTransport();
    const workflow = new RevisitZeroWorkflow(transport);
    const preview = workflow.prepare(eligible, now).preview!;
    const approval = createApprovalReceipt(preview, "tester", now);
    const [first, duplicate] = await Promise.all([
      workflow.execute(eligible, approval, { now }),
      workflow.execute(eligible, approval, { now }),
    ]);
    expect(first.idempotencyReference).toBe(duplicate.idempotencyReference);
    expect(duplicate.duplicatePrevented).toBe(true);
    expect(transport.invocations).toHaveLength(1);
  });

  it("permits at most one call per case even if later content gets a new approval", async () => {
    const transport = new FakeCalleTransport();
    const workflow = new RevisitZeroWorkflow(transport);
    const firstPreview = workflow.prepare(eligible, now).preview!;
    const first = await workflow.execute(eligible, createApprovalReceipt(firstPreview, "tester", now), { now });
    const edited = {
      ...structuredClone(eligible),
      visitWindows: eligible.visitWindows.map((window, index) => index === 0 ? { ...window, label: `${window.label} (updated)` } : window),
    };
    const secondPreview = workflow.prepare(edited, now).preview!;
    const second = await workflow.execute(edited, createApprovalReceipt(secondPreview, "tester", now), { now });
    expect(second.duplicatePrevented).toBe(true);
    expect(second.idempotencyReference).toBe(first.idempotencyReference);
    expect(transport.invocations).toHaveLength(1);
  });

  it("preserves ambiguous outcomes for reconciliation and never redials", async () => {
    const transport = new FakeCalleTransport({ ambiguousCases: new Set([eligible.id]) });
    const workflow = new RevisitZeroWorkflow(transport);
    const preview = workflow.prepare(eligible, now).preview!;
    const approval = createApprovalReceipt(preview, "tester", now);
    const first = await workflow.execute(eligible, approval, { now });
    const duplicate = await workflow.execute(eligible, approval, { now });
    expect(first.disposition).toBe("MANUAL_REVIEW");
    expect(first.reconciliationPending).toBe(true);
    expect(duplicate.duplicatePrevented).toBe(true);
    expect(transport.invocations).toHaveLength(1);
  });

  it("creates future-call suppression from an opt-out result", async () => {
    const optOut: StructuredCallResult = {
      schemaVersion: "1.0",
      contactOutcome: "DO_NOT_CONTACT",
      accessResolution: {
        gateUnlocked: "UNKNOWN",
        dogSecured: "UNKNOWN",
        obstructionRemoved: "UNKNOWN",
        presenceArranged: "UNKNOWN",
        externalAccessPartyResolved: "UNKNOWN",
      },
      selectedVisitWindowId: null,
      optOut: true,
    };
    const transport = new FakeCalleTransport({ results: new Map([[eligible.id, optOut]]) });
    const workflow = new RevisitZeroWorkflow(transport);
    const preview = workflow.prepare(eligible, now).preview!;
    const run = await workflow.execute(eligible, createApprovalReceipt(preview, "tester", now), { now });
    expect(run.disposition).toBe("DO_NOT_CONTACT");
    expect(workflow.prepare(eligible, now).assessment.reasons[0]?.code).toBe("CONTACT_SUPPRESSED");
  });

  it("fails closed on the observed live opt-out conflict without export or redial", async () => {
    const contradictory = { ...structuredClone(GOLDEN_RESULT), optOut: true };
    const transport = new FakeCalleTransport({ results: new Map([[eligible.id, contradictory]]) });
    const workflow = new RevisitZeroWorkflow(transport);
    const preview = workflow.prepare(eligible, now).preview!;
    const approval = createApprovalReceipt(preview, "tester", now);
    const first = await workflow.execute(eligible, approval, { now });
    const duplicate = await workflow.execute(eligible, approval, { now });

    expect(first.disposition).toBe("MANUAL_REVIEW");
    expect(first.validationIssues.map((issue) => issue.code)).toContain("OPT_OUT_OUTCOME_CONFLICT");
    expect(first.structuredResult).toBeNull();
    expect(first.exportState).toBe("NOT_AVAILABLE");
    expect(duplicate.duplicatePrevented).toBe(true);
    expect(transport.invocations).toHaveLength(1);
  });

  it("creates a local-only packet only after explicit human export approval", async () => {
    const transport = new FakeCalleTransport({ results: new Map([[eligible.id, GOLDEN_RESULT]]) });
    const workflow = new RevisitZeroWorkflow(transport);
    const preview = workflow.prepare(eligible, now).preview!;
    const run = await workflow.execute(eligible, createApprovalReceipt(preview, "tester", now), { now });
    expect(decideLocalExport(run, { decision: "REJECT", decidedBy: "reviewer", decidedAt: now.toISOString() })).toBeNull();
    const packet = decideLocalExport(run, { decision: "APPROVE", decidedBy: "reviewer", decidedAt: now.toISOString() });
    expect(packet?.sideEffects).toEqual(["LOCAL_JSON_EXPORT_ONLY"]);
    expect(JSON.stringify(packet)).not.toContain(eligible.recipient.phoneE164);
  });
});
