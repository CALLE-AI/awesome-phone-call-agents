import { z } from "zod";
import { bindingFailures } from "../domain/evaluate-result";
import { assertTransition } from "../domain/case-state";
import {
  appendAudit,
  getCase,
  getIntent,
  updateCaseState,
  updateIntentStatus,
  withTransaction,
  type Db,
} from "../infrastructure/db";
import type { CallProvider } from "../provider/call-provider";
import { mapProviderSnapshot } from "../provider/provider-mapper";
import { recordCallOutcome, type RecordResult } from "./record-call-outcome";
import { liveModeEnabled } from "./live-policy";

const reconcileSchema = z
  .object({
    intentId: z.string().min(1).max(80),
    providerCallId: z.string().min(1).max(128),
  })
  .strict();

export async function reconcileUnknownCall(
  db: Db,
  raw: unknown,
  provider: CallProvider,
): Promise<RecordResult> {
  const input = reconcileSchema.parse(raw);
  if (!liveModeEnabled()) {
    throw new Error("live mode is not enabled on this server");
  }
  const intent = await getIntent(db, input.intentId);
  if (!intent) throw new Error("intent not found");
  const kase = await getCase(db, intent.caseId);
  if (!kase) throw new Error("case not found");
  if (kase.state !== "submission_unknown") {
    throw new Error(`cannot reconcile in state ${kase.state}`);
  }
  if (intent.status !== "reserved" || intent.providerCallId !== null) {
    throw new Error("intent is not awaiting reconciliation");
  }

  const snapshot = mapProviderSnapshot(await provider.get(input.providerCallId));
  const mismatches =
    snapshot.callId !== input.providerCallId
      ? ["binding_call_id"]
      : bindingFailures({ ...intent, providerCallId: input.providerCallId }, snapshot);

  if (mismatches.length > 0) {
    await withTransaction(db, async (tx) => {
      assertTransition(kase.state, "needs_human");
      await updateCaseState(tx, kase.id, "needs_human");
      await updateIntentStatus(tx, intent.id, "expired");
      await appendAudit(tx, {
        caseId: kase.id,
        type: "reconcile.binding_mismatch",
        actor: "operator",
        payload: { intentId: intent.id, failedGates: mismatches },
      });
    });
    return { disposition: "needs_human", caseState: "needs_human", failedGates: mismatches };
  }

  return recordCallOutcome(db, intent.id, snapshot);
}
