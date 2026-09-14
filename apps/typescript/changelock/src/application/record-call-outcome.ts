import { assertTransition } from "../domain/case-state";
import { evaluateCallResult, type NormalizedSnapshot } from "../domain/evaluate-result";
import type { CaseState, Disposition } from "../domain/types";
import {
  appendAudit,
  bindProviderCallId,
  getCase,
  getIntent,
  updateCaseState,
  type Db,
} from "../infrastructure/db";
import { persistSnapshot } from "./persist-snapshot";

const TERMINAL = new Set(["completed", "failed", "canceled", "voicemail", "no_answer", "busy"]);

export interface RecordResult {
  disposition: Disposition | "in_progress";
  caseState: CaseState;
  failedGates: string[];
}

export function recordCallOutcome(
  db: Db,
  intentId: string,
  snapshot: NormalizedSnapshot,
): RecordResult {
  return db.transaction(() => {
    const intent = getIntent(db, intentId);
    if (!intent) throw new Error("intent not found");
    let kase = getCase(db, intent.caseId);
    if (!kase) throw new Error("case not found");
    if (
      kase.state !== "dispatch_reserved" &&
      kase.state !== "submission_unknown" &&
      kase.state !== "call_active" &&
      kase.state !== "terminal_unverified"
    ) {
      throw new Error(`cannot record outcome in state ${kase.state}`);
    }

    if (intent.providerCallId === null) {
      bindProviderCallId(db, intent.id, snapshot.callId);
      intent.providerCallId = snapshot.callId;
      if (intent.status === "reserved") {
        db.prepare("UPDATE call_intents SET status = 'dispatched' WHERE id = ?").run(intent.id);
      }
    }

    persistSnapshot(db, intent.id, snapshot, intent.providerMode);

    if (kase.state === "dispatch_reserved" || kase.state === "submission_unknown") {
      assertTransition(kase.state, "call_active");
      updateCaseState(db, kase.id, "call_active");
      kase = getCase(db, kase.id)!;
    }

    if (!TERMINAL.has(snapshot.status)) {
      appendAudit(db, {
        caseId: kase.id,
        type: "call.in_progress",
        actor: "provider",
        payload: { intentId: intent.id, providerCallId: snapshot.callId, status: snapshot.status },
      });
      return { disposition: "in_progress" as const, caseState: "call_active" as const, failedGates: [] };
    }

    if (kase.state === "call_active") {
      assertTransition(kase.state, "terminal_unverified");
      updateCaseState(db, kase.id, "terminal_unverified");
      kase = getCase(db, kase.id)!;
    }

    const evaluation = evaluateCallResult(intent, snapshot);
    assertTransition(kase.state, evaluation.caseState);
    updateCaseState(db, kase.id, evaluation.caseState);
    appendAudit(db, {
      caseId: kase.id,
      type: "result.evaluated",
      actor: "system",
      payload: {
        intentId: intent.id,
        providerCallId: snapshot.callId,
        disposition: evaluation.disposition,
        caseState: evaluation.caseState,
        failedGates: evaluation.failedGates,
        confidenceScore: snapshot.confidenceScore,
      },
    });
    return evaluation;
  })();
}
