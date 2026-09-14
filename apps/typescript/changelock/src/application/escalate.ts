import { z } from "zod";
import { assertTransition } from "../domain/case-state";
import {
  appendAudit,
  getCase,
  getIntent,
  updateCaseState,
  type Db,
} from "../infrastructure/db";

const escalateSchema = z
  .object({ intentId: z.string().min(1).max(80) })
  .strict();

export function escalateToHuman(db: Db, raw: unknown): void {
  const input = escalateSchema.parse(raw);
  const intent = getIntent(db, input.intentId);
  if (!intent) throw new Error("intent not found");
  const kase = getCase(db, intent.caseId);
  if (!kase) throw new Error("case not found");
  if (kase.state !== "submission_unknown") {
    throw new Error(`cannot escalate in state ${kase.state}`);
  }
  db.transaction(() => {
    assertTransition(kase.state, "needs_human");
    updateCaseState(db, kase.id, "needs_human");
    if (intent.providerCallId === null) {
      db.prepare("UPDATE call_intents SET status = 'expired' WHERE id = ?").run(intent.id);
    }
    appendAudit(db, {
      caseId: kase.id,
      type: "case.escalated",
      actor: "operator",
      payload: { intentId: intent.id },
    });
  })();
}
