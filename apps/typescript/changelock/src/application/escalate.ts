import { z } from "zod";
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

const escalateSchema = z
  .object({ intentId: z.string().min(1).max(80) })
  .strict();

export async function escalateToHuman(db: Db, raw: unknown): Promise<void> {
  const input = escalateSchema.parse(raw);
  const intent = await getIntent(db, input.intentId);
  if (!intent) throw new Error("intent not found");
  const kase = await getCase(db, intent.caseId);
  if (!kase) throw new Error("case not found");
  if (kase.state !== "submission_unknown") {
    throw new Error(`cannot escalate in state ${kase.state}`);
  }
  await withTransaction(db, async (tx) => {
    assertTransition(kase.state, "needs_human");
    await updateCaseState(tx, kase.id, "needs_human");
    if (intent.providerCallId === null) {
      await updateIntentStatus(tx, intent.id, "expired");
    }
    await appendAudit(tx, {
      caseId: kase.id,
      type: "case.escalated",
      actor: "operator",
      payload: { intentId: intent.id },
    });
  });
}
