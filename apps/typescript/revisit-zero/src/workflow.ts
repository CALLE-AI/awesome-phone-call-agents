import {
  buildProviderDispatchBinding,
  createProviderIdempotencyKey,
  type CalleTransport,
  type CallOutcome,
} from "./calle-client.js";
import type { DecisionReason, Disposition, FailedVisitCase, PreCallAssessment } from "./case.js";
import { maskPhone } from "./case.js";
import { decideRebookReadiness } from "./decision.js";
import { assessPreCall, SuppressionRegistry } from "./policy.js";
import { createCallPreview, isApprovalValid, type ApprovalReceipt, type CallPreview } from "./preview.js";
import { emptyUnreachedResult, type StructuredCallResult } from "./result-schema.js";
import { validateStructuredResult, type ValidationIssue } from "./validation.js";

export type ApprovalState = "NOT_REQUIRED" | "EXACT_CONTENT_APPROVED" | "INVALIDATED";

export interface TimelineEvent {
  at: string;
  type: "POLICY" | "APPROVAL" | "CALL_RESERVED" | "CALL_RESULT" | "RECONCILIATION" | "DECISION";
  message: string;
}

export interface WorkflowRun {
  caseId: string;
  sourceFailure: FailedVisitCase["sourceFailure"];
  preCallAssessment: PreCallAssessment;
  approvalState: ApprovalState;
  disposition: Disposition;
  decisionReasons: DecisionReason[];
  unresolvedFields: string[];
  structuredResult: StructuredCallResult | null;
  validationIssues: ValidationIssue[];
  maskedRecipient: string;
  callId: string | null;
  idempotencyReference: string | null;
  reconciliationPending: boolean;
  exportState: "NOT_AVAILABLE" | "PENDING_HUMAN_APPROVAL";
  timeline: TimelineEvent[];
  duplicatePrevented: boolean;
}

export interface PreparedCase {
  assessment: PreCallAssessment;
  preview: CallPreview | null;
}

export interface ExecuteOptions {
  now: Date;
  liveControl?: {
    liveModeEnabled: boolean;
    explicitOperatorLiveApproval: boolean;
  };
}

export interface ExportDecisionReceipt {
  decision: "APPROVE" | "REJECT";
  decidedBy: string;
  decidedAt: string;
}

export interface LocalExportPacket {
  schemaVersion: "1.0";
  generatedAt: string;
  generatedBy: string;
  humanDecision: "APPROVE";
  caseId: string;
  sourceFailure: FailedVisitCase["sourceFailure"];
  validatedStructuredResult: StructuredCallResult;
  recommendation: Disposition;
  decisionReasons: DecisionReason[];
  unresolvedFields: string[];
  maskedRecipient: string;
  callId: string;
  idempotencyReference: string;
  approvalState: "EXACT_CONTENT_APPROVED";
  sideEffects: ["LOCAL_JSON_EXPORT_ONLY"];
}

export class WorkflowLedger {
  readonly #runs = new Map<string, Promise<WorkflowRun>>();
  readonly #caseReferences = new Map<string, string>();

  async runOnce(caseId: string, idempotencyKey: string, operation: () => Promise<WorkflowRun>): Promise<WorkflowRun> {
    const reservedReference = this.#caseReferences.get(caseId);
    if (reservedReference) {
      const reservedRun = this.#runs.get(reservedReference);
      if (!reservedRun) throw new Error("Case reservation ledger is inconsistent");
      return { ...(await reservedRun), duplicatePrevented: true };
    }
    const existing = this.#runs.get(idempotencyKey);
    if (existing) return { ...(await existing), duplicatePrevented: true };
    const pending = operation();
    this.#caseReferences.set(caseId, idempotencyKey);
    this.#runs.set(idempotencyKey, pending);
    try {
      return await pending;
    } catch (error) {
      // Preserve a deterministic failed record rather than freeing the key for a retry.
      const failed = Promise.resolve(makeLedgerFailure(caseId, idempotencyKey, error));
      this.#runs.set(idempotencyKey, failed);
      return failed;
    }
  }

  has(idempotencyKey: string): boolean {
    return this.#runs.has(idempotencyKey);
  }
}

export class RevisitZeroWorkflow {
  constructor(
    readonly transport: CalleTransport,
    readonly suppressions = new SuppressionRegistry(),
    readonly ledger = new WorkflowLedger(),
  ) {}

  prepare(failedVisit: FailedVisitCase, now: Date): PreparedCase {
    const assessment = assessPreCall(failedVisit, now, this.suppressions);
    return {
      assessment,
      preview: assessment.decision === "ELIGIBLE_FOR_CALL" ? createCallPreview(failedVisit) : null,
    };
  }

  async execute(failedVisit: FailedVisitCase, approval: ApprovalReceipt | null, options: ExecuteOptions): Promise<WorkflowRun> {
    const prepared = this.prepare(failedVisit, options.now);
    const baseTimeline: TimelineEvent[] = [{
      at: options.now.toISOString(),
      type: "POLICY",
      message: prepared.assessment.decision,
    }];

    if (prepared.assessment.decision !== "ELIGIBLE_FOR_CALL" || !prepared.preview) {
      return blockedRun(failedVisit, prepared.assessment, baseTimeline);
    }
    if (!approval || !isApprovalValid(approval, prepared.preview)) {
      return {
        ...baseRun(failedVisit, prepared.assessment, "INVALIDATED", baseTimeline),
        disposition: "AUTOMATION_BLOCKED",
        decisionReasons: [{ code: "APPROVAL_INVALIDATED", message: "The exact approved content no longer matches the current case and call preview." }],
        unresolvedFields: [],
      };
    }
    if (this.transport.mode === "live" && (!options.liveControl?.liveModeEnabled || !options.liveControl.explicitOperatorLiveApproval)) {
      return {
        ...baseRun(failedVisit, prepared.assessment, "EXACT_CONTENT_APPROVED", baseTimeline),
        disposition: "AUTOMATION_BLOCKED",
        decisionReasons: [{ code: "LIVE_CONTROL_NOT_APPROVED", message: "Live mode requires both the server flag and explicit per-call operator approval." }],
        unresolvedFields: [],
      };
    }

    const approvedPreview = prepared.preview;

    let idempotencyReference: string;
    try {
      idempotencyReference = createProviderIdempotencyKey(buildProviderDispatchBinding(
        failedVisit.recipient.phoneE164,
        approvedPreview.content,
        approval,
      ));
    } catch (error) {
      return {
        ...baseRun(failedVisit, prepared.assessment, "EXACT_CONTENT_APPROVED", baseTimeline),
        disposition: "AUTOMATION_BLOCKED",
        decisionReasons: [{
          code: "APPROVED_DISPATCH_INVALID",
          message: error instanceof Error ? error.message : "The exact approved provider dispatch payload is invalid.",
        }],
        unresolvedFields: [],
      };
    }

    return this.ledger.runOnce(failedVisit.id, idempotencyReference, async () => {
      const timeline = [...baseTimeline,
        { at: approval.approvedAt, type: "APPROVAL" as const, message: "Exact preview approved." },
        { at: options.now.toISOString(), type: "CALL_RESERVED" as const, message: "One-call idempotency key reserved before provider invocation." },
      ];
      let providerOutcome: CallOutcome;
      try {
        providerOutcome = await this.transport.startOneCall({
          caseId: failedVisit.id,
          recipientPhoneE164: failedVisit.recipient.phoneE164,
          preview: approvedPreview.content,
          approval,
          idempotencyKey: idempotencyReference,
        });
      } catch (error) {
        providerOutcome = {
          kind: "AMBIGUOUS",
          reconciliationReference: idempotencyReference,
          reason: error instanceof Error ? `${error.name} created an uncertain provider outcome.` : "Unknown provider failure created an uncertain outcome.",
        };
      }
      return this.#complete(failedVisit, prepared.assessment, idempotencyReference, providerOutcome, timeline, options.now);
    });
  }

  #complete(
    failedVisit: FailedVisitCase,
    assessment: PreCallAssessment,
    idempotencyReference: string,
    outcome: CallOutcome,
    timeline: TimelineEvent[],
    now: Date,
  ): WorkflowRun {
    if (outcome.kind === "AMBIGUOUS") {
      return {
        ...baseRun(failedVisit, assessment, "EXACT_CONTENT_APPROVED", [
          ...timeline,
          { at: now.toISOString(), type: "RECONCILIATION", message: outcome.reason },
        ]),
        disposition: "MANUAL_REVIEW",
        decisionReasons: [{ code: "AMBIGUOUS_PROVIDER_OUTCOME", message: outcome.reason }],
        unresolvedFields: ["providerOutcome"],
        callId: outcome.callId ?? null,
        idempotencyReference,
        reconciliationPending: true,
      };
    }
    if (outcome.kind === "REJECTED_BEFORE_START") {
      return {
        ...baseRun(failedVisit, assessment, "EXACT_CONTENT_APPROVED", [
          ...timeline,
          { at: now.toISOString(), type: "CALL_RESULT", message: "Provider rejected the request; the reserved key remains consumed." },
        ]),
        disposition: "MANUAL_REVIEW",
        decisionReasons: [{ code: "CALL_REJECTED", message: outcome.reason }],
        unresolvedFields: ["providerOutcome"],
        idempotencyReference,
      };
    }

    const rawResult = outcome.kind === "UNREACHED" ? emptyUnreachedResult() : outcome.rawResult;
    const validation = validateStructuredResult(rawResult, failedVisit);
    const decision = decideRebookReadiness(failedVisit, validation);
    if (validation.valid && validation.result.optOut) {
      this.suppressions.suppress(failedVisit.recipient.phoneE164);
    }
    return {
      ...baseRun(failedVisit, assessment, "EXACT_CONTENT_APPROVED", [
        ...timeline,
        { at: now.toISOString(), type: "CALL_RESULT", message: validation.valid ? "Closed result validated." : "Result rejected by strict local validation." },
        { at: now.toISOString(), type: "DECISION", message: decision.disposition },
      ]),
      disposition: decision.disposition,
      decisionReasons: decision.reasons,
      unresolvedFields: decision.unresolvedFields,
      structuredResult: validation.valid ? validation.result : null,
      validationIssues: validation.valid ? [] : validation.issues,
      callId: outcome.callId,
      idempotencyReference,
      exportState: validation.valid ? "PENDING_HUMAN_APPROVAL" : "NOT_AVAILABLE",
    };
  }
}

export function decideLocalExport(run: WorkflowRun, receipt: ExportDecisionReceipt): LocalExportPacket | null {
  if (!receipt.decidedBy.trim() || !Number.isFinite(Date.parse(receipt.decidedAt))) throw new Error("A valid human export decision is required");
  if (receipt.decision === "REJECT") return null;
  if (
    run.exportState !== "PENDING_HUMAN_APPROVAL" ||
    run.approvalState !== "EXACT_CONTENT_APPROVED" ||
    !run.structuredResult || !run.callId || !run.idempotencyReference
  ) {
    throw new Error("This run is not eligible for local export");
  }
  return {
    schemaVersion: "1.0",
    generatedAt: receipt.decidedAt,
    generatedBy: receipt.decidedBy.trim(),
    humanDecision: "APPROVE",
    caseId: run.caseId,
    sourceFailure: run.sourceFailure,
    validatedStructuredResult: run.structuredResult,
    recommendation: run.disposition,
    decisionReasons: run.decisionReasons,
    unresolvedFields: run.unresolvedFields,
    maskedRecipient: run.maskedRecipient,
    callId: run.callId,
    idempotencyReference: run.idempotencyReference,
    approvalState: "EXACT_CONTENT_APPROVED",
    sideEffects: ["LOCAL_JSON_EXPORT_ONLY"],
  };
}

function blockedRun(failedVisit: FailedVisitCase, assessment: PreCallAssessment, timeline: TimelineEvent[]): WorkflowRun {
  return {
    ...baseRun(failedVisit, assessment, "NOT_REQUIRED", timeline),
    disposition: assessment.decision === "MANUAL_REVIEW_REQUIRED" ? "MANUAL_REVIEW" : "AUTOMATION_BLOCKED",
    decisionReasons: assessment.reasons,
    unresolvedFields: [],
  };
}

function baseRun(failedVisit: FailedVisitCase, assessment: PreCallAssessment, approvalState: ApprovalState, timeline: TimelineEvent[]): WorkflowRun {
  return {
    caseId: failedVisit.id,
    sourceFailure: structuredClone(failedVisit.sourceFailure),
    preCallAssessment: assessment,
    approvalState,
    disposition: "MANUAL_REVIEW",
    decisionReasons: [],
    unresolvedFields: [],
    structuredResult: null,
    validationIssues: [],
    maskedRecipient: maskPhone(failedVisit.recipient.phoneE164),
    callId: null,
    idempotencyReference: null,
    reconciliationPending: false,
    exportState: "NOT_AVAILABLE",
    timeline,
    duplicatePrevented: false,
  };
}

function makeLedgerFailure(caseId: string, idempotencyReference: string, error: unknown): WorkflowRun {
  const now = new Date().toISOString();
  return {
    caseId,
    sourceFailure: { summary: "Unavailable", lockedGate: false, unsecuredDog: false, obstruction: false, presenceRequired: false, accessControl: "CUSTOMER_CONTROLLED" },
    preCallAssessment: { decision: "ELIGIBLE_FOR_CALL", reasons: [], evaluatedAt: now },
    approvalState: "EXACT_CONTENT_APPROVED",
    disposition: "MANUAL_REVIEW",
    decisionReasons: [{ code: "WORKFLOW_FAILURE", message: error instanceof Error ? error.name : "Unknown workflow failure" }],
    unresolvedFields: ["workflow"],
    structuredResult: null,
    validationIssues: [],
    maskedRecipient: "UNAVAILABLE",
    callId: null,
    idempotencyReference,
    reconciliationPending: true,
    exportState: "NOT_AVAILABLE",
    timeline: [{ at: now, type: "RECONCILIATION", message: "Unexpected workflow failure preserved without retry." }],
    duplicatePrevented: false,
  };
}
