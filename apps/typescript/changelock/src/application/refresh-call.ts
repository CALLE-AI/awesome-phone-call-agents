import { appendAudit, getCase, getIntent, type Db } from "../infrastructure/db";
import { mapProviderSnapshot } from "../provider/provider-mapper";
import type { CallProvider } from "../provider/call-provider";
import { recordCallOutcome, type RecordResult } from "./record-call-outcome";

export async function refreshCall(
  db: Db,
  intentId: string,
  provider: CallProvider,
): Promise<RecordResult> {
  const intent = await getIntent(db, intentId);
  if (!intent) throw new Error("intent not found");
  const kase = await getCase(db, intent.caseId);
  if (!kase) throw new Error("case not found");
  if (!intent.providerCallId) throw new Error("intent has no bound call to refresh");
  const providerSnapshot = await provider.get(intent.providerCallId);
  const result = await recordCallOutcome(db, intent.id, mapProviderSnapshot(providerSnapshot));
  await appendAudit(db, {
    caseId: kase.id,
    type: "call.refreshed",
    actor: "operator",
    payload: { intentId: intent.id, providerCallId: intent.providerCallId },
  });
  return result;
}
