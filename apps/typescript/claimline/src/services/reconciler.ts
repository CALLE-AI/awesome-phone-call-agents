import type { ClaimLineConfig } from "../config.js";
import type { CalleGateway, CallSnapshot } from "../calle/gateway.js";
import {
  classifyDisposition,
  detectRefusal,
  detectVoicemail,
} from "../domain/disposition.js";
import { canTransition } from "../domain/states.js";
import type { CallIntent, CallResultRecord } from "../domain/types.js";
import { validateFnolResult } from "../schemas/fnol.js";
import { validateStatusChaseResult } from "../schemas/status-chase.js";
import { validateMedicalReportResult } from "../schemas/medical.js";
import { validateBillVerificationResult } from "../schemas/bill.js";
import type { Store } from "../store/store.js";
import type { Dispatcher } from "./dispatcher.js";

const TERMINAL_CALL_STATUSES = new Set(["completed", "failed", "canceled"]);

export interface PollSummary {
  processedInbox: number;
  polledIntents: number;
  verified: number;
  needsHuman: number;
  resubmitted: number;
  stillWaiting: number;
}

/**
 * Reconciliation worker. It never trusts a webhook body as the source of truth:
 * a webhook only wakes it, and it always fetches the AUTHORITATIVE call state
 * from CALL-E before verifying binding, validating the structured result, and
 * transitioning the intent. Runs are idempotent and crash-safe.
 */
export class Reconciler {
  constructor(
    private readonly store: Store,
    private readonly gateway: CalleGateway,
    private readonly dispatcher: Dispatcher,
    private readonly config: ClaimLineConfig,
  ) {}

  async pollOnce(opts?: { placedBy?: string[]; claimId?: string }): Promise<PollSummary> {
    const summary: PollSummary = {
      processedInbox: 0,
      polledIntents: 0,
      verified: 0,
      needsHuman: 0,
      resubmitted: 0,
      stillWaiting: 0,
    };
    const allow = (intent: CallIntent): boolean => {
      if (opts?.placedBy && !opts.placedBy.includes(intent.placedBy ?? "fixture")) {
        return false;
      }
      if (opts?.claimId && intent.claimId !== opts.claimId) return false;
      return true;
    };

    // 1. Drain the durable webhook inbox (wake signals only).
    for (const entry of this.store.listUnprocessedInbox()) {
      const intent = this.store.getIntentByCallId(entry.callId);
      if (intent && allow(intent)) await this.reconcileIntent(intent, summary);
      this.store.markInboxProcessed(entry.eventId);
      summary.processedInbox += 1;
    }

    // 2. Poll everything still in flight (optionally filtered).
    const inFlight = this.store
      .listIntentsByStates(["accepted", "submission_unknown", "terminal_unverified"])
      .filter(allow);
    for (const intent of inFlight) {
      summary.polledIntents += 1;
      await this.reconcileIntent(intent, summary);
    }

    return summary;
  }

  async reconcileIntent(
    intent: CallIntent,
    summary?: PollSummary,
  ): Promise<CallIntent> {
    if (intent.state === "submission_unknown") {
      try {
        const updated = await this.dispatcher.retrySubmission(intent.id);
        if (summary && updated.state === "accepted") summary.resubmitted += 1;
        return updated;
      } catch {
        // Leave as submission_unknown; a later poll retries safely.
        return intent;
      }
    }

    if (intent.state !== "accepted" && intent.state !== "terminal_unverified") {
      return intent;
    }
    if (!intent.callId) return intent;

    const snapshot = await this.gateway.getCall(intent.callId);
    if (!TERMINAL_CALL_STATUSES.has(snapshot.status)) {
      if (summary) summary.stillWaiting += 1;
      return intent;
    }

    return this.processTerminal(intent, snapshot, summary);
  }

  private processTerminal(
    intent: CallIntent,
    snapshot: CallSnapshot,
    summary?: PollSummary,
  ): CallIntent {
    // Binding: the authoritative call must be the one we accepted.
    if (snapshot.callId !== intent.callId) {
      this.saveResult(intent, snapshot, "needs_human", "binding_mismatch");
      const updated = canTransition(intent.state, "needs_human")
        ? this.store.updateIntentState(intent.id, "needs_human", {
            reason: "binding_mismatch",
          })
        : intent;
      if (summary) summary.needsHuman += 1;
      return updated;
    }

    let current = intent;
    if (current.state === "accepted") {
      current = this.store.updateIntentState(current.id, "terminal_unverified");
    }

    const validation = this.validate(intent, snapshot);
    const voicemailDetected = detectVoicemail(
      snapshot.transcript,
      snapshot.summary,
    );
    const refusalDetected = detectRefusal(snapshot.transcript, snapshot.summary);

    const { disposition, reason } = classifyDisposition(
      {
        status: snapshot.status,
        taskCompleted: snapshot.taskCompleted,
        confidenceScore: snapshot.completionConfidence?.score ?? null,
        confidenceLabel: snapshot.completionConfidence?.label ?? null,
        structuredResult: snapshot.structuredResult,
        schemaValid: validation.valid,
        voicemailDetected,
        refusalDetected,
      },
      this.config.confidenceThreshold,
    );

    const fullReason = validation.valid
      ? reason
      : `${reason}|schema:${validation.errors.join(",")}`;

    this.saveResult(intent, snapshot, disposition, fullReason);

    if (disposition === "auto_ok") {
      const updated = this.store.updateIntentState(
        current.id,
        "terminal_verified",
      );
      if (summary) summary.verified += 1;
      return updated;
    }
    const updated = this.store.updateIntentState(current.id, "needs_human", {
      reason: fullReason,
    });
    if (summary) summary.needsHuman += 1;
    return updated;
  }

  private validate(
    intent: CallIntent,
    snapshot: CallSnapshot,
  ): { valid: boolean; errors: string[] } {
    if (snapshot.structuredResult === null) {
      return { valid: false, errors: ["missing_structured_result"] };
    }
    switch (intent.callType) {
      case "fnol_intake":
        return validateFnolResult(snapshot.structuredResult);
      case "status_chase":
        return validateStatusChaseResult(snapshot.structuredResult);
      case "medical_report":
        return validateMedicalReportResult(snapshot.structuredResult);
      case "bill_verification":
        return validateBillVerificationResult(snapshot.structuredResult);
      default:
        return { valid: false, errors: ["unknown_call_type"] };
    }
  }

  private saveResult(
    intent: CallIntent,
    snapshot: CallSnapshot,
    disposition: CallResultRecord["disposition"],
    dispositionReason: string,
  ): void {
    const record: CallResultRecord = {
      intentId: intent.id,
      callId: snapshot.callId,
      status: snapshot.status,
      taskCompleted: snapshot.taskCompleted,
      confidenceScore: snapshot.completionConfidence?.score ?? null,
      confidenceLabel: snapshot.completionConfidence?.label ?? null,
      structuredResult: snapshot.structuredResult,
      evidence: snapshot.evidence,
      summary: snapshot.summary,
      transcript: snapshot.transcript,
      disposition,
      dispositionReason,
      receivedAt: new Date().toISOString(),
    };
    this.store.saveResult(record);
  }
}
