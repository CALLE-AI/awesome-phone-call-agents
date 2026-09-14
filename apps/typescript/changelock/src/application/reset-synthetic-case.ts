import { z } from "zod";
import {
  getCase,
  getChangeRequest,
  resetCaseCallArtifacts,
  type Db,
} from "../infrastructure/db";
import { SEED_EVENTS } from "../fixtures/seed-data";
import type { CaseState } from "../domain/types";

const resetSchema = z.object({ caseId: z.string().min(1).max(80) }).strict();

const SYNTHETIC_EVENT_IDS: ReadonlySet<string> = new Set(
  SEED_EVENTS.map((e) => e.externalEventId),
);

const RESETTABLE_STATES: ReadonlySet<CaseState> = new Set([
  "verification_confirmed",
  "verification_denied",
  "needs_human",
]);

export function isResettableSyntheticCase(state: CaseState, externalEventId: string): boolean {
  return RESETTABLE_STATES.has(state) && SYNTHETIC_EVENT_IDS.has(externalEventId);
}

// Shared-state recovery for demo environments (Turso, public deployments): a
// terminal seeded case is cleared back to needs_review so judges can replay it.
// Deliberately bypasses the domain state machine — terminal states have no
// legal outgoing transitions, and this is an operator maintenance action, not a
// verification outcome. Never touches vendors, contacts, or the change request.
//
// The eligibility reads below decide which error to raise; correctness under
// concurrent resets is owned by the atomic guarded batch, not by these reads.
// Two racing resets on the same case: exactly one batch lands (the other
// no-ops), and the loser is rejected with the now-current state.
export async function resetSyntheticCase(db: Db, raw: unknown): Promise<void> {
  const input = resetSchema.parse(raw);
  if (process.env.CHANGELOCK_MODE === "live") {
    throw new Error("synthetic case reset is not available in live mode");
  }
  const kase = await getCase(db, input.caseId);
  if (!kase) throw new Error("case not found");
  const request = await getChangeRequest(db, kase.changeRequestId);
  if (!request) throw new Error("change request missing");
  if (!SYNTHETIC_EVENT_IDS.has(request.externalEventId)) {
    throw new Error("only seeded synthetic cases can be reset");
  }
  if (!RESETTABLE_STATES.has(kase.state)) {
    throw new Error(`cannot reset in state ${kase.state}`);
  }

  const won = await resetCaseCallArtifacts(db, kase.id, {
    type: "demo.reset",
    actor: "operator",
    payload: {
      caseId: kase.id,
      safeCaseCode: kase.safeCaseCode,
      externalEventId: request.externalEventId,
      scope: "synthetic case call artifacts only; change request stays held",
    },
  });
  if (!won) {
    const current = await getCase(db, input.caseId);
    throw new Error(`cannot reset in state ${current?.state ?? "needs_review"}`);
  }
}
