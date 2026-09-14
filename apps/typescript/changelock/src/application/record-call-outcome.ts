import { assertTransition } from "../domain/case-state";
import { evaluateCallResult, type NormalizedSnapshot } from "../domain/evaluate-result";
import type { CaseState, Disposition } from "../domain/types";
import {
  appendAudit,
  bindProviderCallId,
  getCase,
  getIntent,
  updateCaseState,
  updateIntentStatus,
  withTransaction,
  type Db,
} from "../infrastructure/db";
import { persistSnapshot } from "./persist-snapshot";

const TERMINAL = new Set(["completed", "failed", "canceled", "voicemail", "no_answer", "busy"]);

export interface RecordResult {
  disposition: Disposition | "in_progress";
  caseState: CaseState;
  failedGates: string[];
}

export async function recordCallOutcome(
  db: Db,
  intentId: string,
  snapshot: NormalizedSnapshot,
): Promise<RecordResult> {
  return withTransaction(db, async (tx) => {
    const intent = await getIntent(tx, intentId);
    if (!intent) throw new Error("intent not found");
    let kase = await getCase(tx, intent.caseId);
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
      await bindProviderCallId(tx, intent.id, snapshot.callId);
      intent.providerCallId = snapshot.callId;
      if (intent.status === "reserved") {
        await updateIntentStatus(tx, intent.id, "dispatched");
      }
    }

    await persistSnapshot(tx, intent.id, snapshot, intent.providerMode);

    if (kase.state === "dispatch_reserved" || kase.state === "submission_unknown") {
      assertTransition(kase.state, "call_active");
      await updateCaseState(tx, kase.id, "call_active");
      kase = (await getCase(tx, kase.id))!;
    }

    if (!TERMINAL.has(snapshot.status)) {
      await appendAudit(tx, {
        caseId: kase.id,
        type: "call.in_progress",
        actor: "provider",
        payload: { intentId: intent.id, providerCallId: snapshot.callId, status: snapshot.status },
      });
      return { disposition: "in_progress" as const, caseState: "call_active" as const, failedGates: [] };
    }

    if (kase.state === "call_active") {
      assertTransition(kase.state, "terminal_unverified");
      await updateCaseState(tx, kase.id, "terminal_unverified");
      kase = (await getCase(tx, kase.id))!;
    }

    const evaluation = evaluateCallResult(intent, snapshot);
    assertTransition(kase.state, evaluation.caseState);
    await updateCaseState(tx, kase.id, evaluation.caseState);
    await appendAudit(tx, {
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
  });
}
