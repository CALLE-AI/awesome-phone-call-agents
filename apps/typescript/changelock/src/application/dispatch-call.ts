import { z } from "zod";
import { assertTransition } from "../domain/case-state";
import {
  appendAudit,
  getCase,
  getIntent,
  bindProviderCallId,
  updateCaseState,
  updateIntentStatus,
  withTransaction,
  type Db,
} from "../infrastructure/db";
import { createLiveCallProvider } from "../provider/calle-provider";
import { mapProviderSnapshot } from "../provider/provider-mapper";
import { ReplayCallProvider, type ReplayScenario } from "../provider/replay-provider";
import type { CallProvider } from "../provider/call-provider";
import { resolveDispatchInput } from "./resolve-dispatch-input";
import { recordCallOutcome } from "./record-call-outcome";

const dispatchSchema = z
  .object({
    intentId: z.string().min(1),
    scenario: z.string().optional(),
  })
  .strict();

const REPLAY_SCENARIOS: ReplayScenario[] = [
  "confirmed",
  "denied",
  "unable-to-verify",
  "unreachable",
  "sensitive-data",
  "malformed",
  "in-progress",
  "acceptance_unknown",
  "rejected",
];

export interface DispatchResult {
  caseId: string;
  providerCallId: string | null;
  outcome: "accepted" | "rejected" | "acceptance_unknown";
  state: string;
}

function resolveProvider(intentMode: "replay" | "live", scenario: string | undefined): CallProvider {
  if (intentMode === "live") {
    return createLiveCallProvider();
  }
  const s = (scenario ?? "confirmed") as ReplayScenario;
  if (!REPLAY_SCENARIOS.includes(s)) {
    throw new Error("unknown replay scenario");
  }
  return new ReplayCallProvider(s);
}

export async function dispatchCall(
  db: Db,
  raw: unknown,
  injectedProvider?: CallProvider,
): Promise<DispatchResult> {
  const input = dispatchSchema.parse(raw);
  const intent = await getIntent(db, input.intentId);
  if (!intent) throw new Error("intent not found");
  const kase = await getCase(db, intent.caseId);
  if (!kase) throw new Error("case not found");
  if (intent.status !== "reserved") {
    throw new Error(`intent is ${intent.status}; refusing to dispatch again`);
  }
  if (kase.state !== "dispatch_reserved") {
    throw new Error(`case is ${kase.state}; cannot dispatch`);
  }
  if (new Date(intent.expiresAt).getTime() <= Date.now()) {
    await withTransaction(db, async (tx) => {
      await updateIntentStatus(tx, intent.id, "expired");
      assertTransition(kase.state, "needs_review");
      await updateCaseState(tx, kase.id, "needs_review");
      await appendAudit(tx, {
        caseId: kase.id,
        type: "intent.expired",
        actor: "system",
        payload: { intentId: intent.id, reason: "authorization window elapsed" },
      });
    });
    throw new Error("authorization expired; create a new preview and re-authorize");
  }
  if (intent.providerMode === "live" && process.env.CHANGELOCK_MODE !== "live") {
    throw new Error("live dispatch refused: server is not in live mode");
  }

  const provider = injectedProvider ?? resolveProvider(intent.providerMode, input.scenario);
  const callInput = await resolveDispatchInput(db, intent.id);
  const outcome = await provider.create(callInput);

  if (outcome.kind === "rejected") {
    await withTransaction(db, async (tx) => {
      await updateIntentStatus(tx, intent.id, "expired");
      assertTransition(kase.state, "needs_review");
      await updateCaseState(tx, kase.id, "needs_review");
      await appendAudit(tx, {
        caseId: kase.id,
        type: "dispatch.rejected",
        actor: "provider",
        payload: { intentId: intent.id, code: outcome.code },
      });
    });
    return { caseId: kase.id, providerCallId: null, outcome: "rejected", state: "needs_review" };
  }

  if (outcome.kind === "acceptance_unknown") {
    await withTransaction(db, async (tx) => {
      assertTransition(kase.state, "submission_unknown");
      await updateCaseState(tx, kase.id, "submission_unknown");
      await appendAudit(tx, {
        caseId: kase.id,
        type: "dispatch.acceptance_unknown",
        actor: "provider",
        payload: { intentId: intent.id, code: outcome.code, autoRetry: false },
      });
    });
    return {
      caseId: kase.id,
      providerCallId: null,
      outcome: "acceptance_unknown",
      state: "submission_unknown",
    };
  }

  await withTransaction(db, async (tx) => {
    await bindProviderCallId(tx, intent.id, outcome.snapshot.id);
    assertTransition(kase.state, "call_active");
    await updateCaseState(tx, kase.id, "call_active");
    await appendAudit(tx, {
      caseId: kase.id,
      type: "dispatch.accepted",
      actor: "provider",
      payload: {
        intentId: intent.id,
        providerCallId: outcome.snapshot.id,
        providerMode: intent.providerMode,
      },
    });
  });

  const snapshot = mapProviderSnapshot(outcome.snapshot);
  await recordCallOutcome(db, intent.id, snapshot);

  const after = (await getCase(db, kase.id))!;
  return {
    caseId: kase.id,
    providerCallId: outcome.snapshot.id,
    outcome: "accepted",
    state: after.state,
  };
}
