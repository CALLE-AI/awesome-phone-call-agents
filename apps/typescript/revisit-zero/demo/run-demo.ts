import failedVisitsJson from "../examples/failed-visits.json" with { type: "json" };
import type { FailedVisitCase } from "../src/case.js";
import { createApprovalReceipt } from "../src/preview.js";
import { RevisitZeroWorkflow } from "../src/workflow.js";
import { FakeCalleTransport } from "./fake-calle.js";

const failedVisits = failedVisitsJson as FailedVisitCase[];
const transport = new FakeCalleTransport();
const workflow = new RevisitZeroWorkflow(transport);
const now = new Date("2026-08-12T10:00:00+10:00");

const expected = new Map<string, string>([
  ["MTR-2026-0042", "READY_FOR_REBOOK_REVIEW"],
  ["MTR-2026-0043", "MANUAL_REVIEW"],
  ["MTR-2026-0044", "AUTOMATION_BLOCKED"],
]);

for (const failedVisit of failedVisits) {
  const prepared = workflow.prepare(failedVisit, now);
  const approval = prepared.preview ? createApprovalReceipt(prepared.preview, "demo-operator", now) : null;
  const run = await workflow.execute(failedVisit, approval, { now });
  if (run.disposition !== expected.get(failedVisit.id)) {
    throw new Error(`${failedVisit.id}: expected ${expected.get(failedVisit.id)}, received ${run.disposition}`);
  }
  console.log(JSON.stringify({
    caseId: run.caseId,
    preCallDecision: run.preCallAssessment.decision,
    disposition: run.disposition,
    callId: run.callId,
    recipient: run.maskedRecipient,
  }));
}

if (transport.invocations.length !== 1) throw new Error(`Expected exactly one fake call, received ${transport.invocations.length}`);
console.log("RevisitZero demo passed: 3 cases, 1 fake call, 0 real side effects.");
