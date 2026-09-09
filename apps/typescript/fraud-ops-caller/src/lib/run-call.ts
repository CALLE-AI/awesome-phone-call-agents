import "server-only";

import { placeCall, toDialRequest } from "./calle";
import { getCase } from "./cases";
import { failClosed } from "./map-live-result";
import { composeOutcome, composeOutcomeOrUnknown } from "./outcome";
import { buildCallPlan } from "./plan";
import type { FraudOpsOutcome } from "./types";

export const LIVE_CONFIRM_PHRASE = "I understand this places a real phone call";

type Claim =
  | { state: "in_flight" }
  | { state: "done"; result: Extract<RunCallResult, { ok: true }> };

const claims = new Map<string, Claim>();

export function resetIdempotencyForTests(): void {
  claims.clear();
}

export function isLiveAvailable(): boolean {
  return Boolean(
    process.env.CALLE_API_KEY?.trim() &&
      process.env.CALLE_BASE_URL?.trim() &&
      process.env.CALLE_LIVE_CALLS_ENABLED === "true"
  );
}

export type RunCallInput = {
  caseId: string;
  mode: "demo" | "live";
  confirmLive?: string;
  fast?: boolean;
  now?: Date;
};

export type RunCallResult =
  | {
      ok: true;
      status: 200;
      body: {
        outcome: FraudOpsOutcome;
        plan: { maskedTo: string; idempotencyKey: string; provider: "calle-stub" | "calle" };
      };
    }
  | { ok: false; status: 403 | 404 | 409 | 500; body: { error: string; reasons?: string[] } };

export async function executeCallRun(input: RunCallInput): Promise<RunCallResult> {
  const fraudCase = getCase(input.caseId);
  if (!fraudCase) return { ok: false, status: 404, body: { error: "unknown caseId" } };

  const plan = await buildCallPlan(fraudCase, input.now);
  if (!plan.gate.automate) {
    return {
      ok: false,
      status: 409,
      body: { error: "gate blocked", reasons: plan.gate.reasons },
    };
  }

  if (input.mode === "live") {
    if (!isLiveAvailable() || input.confirmLive !== LIVE_CONFIRM_PHRASE) {
      return { ok: false, status: 403, body: { error: "live call not authorized" } };
    }
  }

  const existing = claims.get(plan.idempotencyKey);
  if (existing?.state === "in_flight") {
    return { ok: false, status: 409, body: { error: "call already in flight" } };
  }
  if (existing?.state === "done") return existing.result;

  claims.set(plan.idempotencyKey, { state: "in_flight" });

  if (input.mode === "live") {
    let outcome: FraudOpsOutcome;
    try {
      const { placeLiveCall } = await import("./calle-live");
      const dial = await placeLiveCall(fraudCase, plan);
      outcome = composeOutcomeOrUnknown(fraudCase, dial);
    } catch {
      outcome = composeOutcome(fraudCase, failClosed(fraudCase, "outcome_unknown"));
    }
    const result: Extract<RunCallResult, { ok: true }> = {
      ok: true,
      status: 200,
      body: {
        outcome,
        plan: {
          maskedTo: plan.maskedTo,
          idempotencyKey: plan.idempotencyKey,
          provider: "calle",
        },
      },
    };
    claims.set(plan.idempotencyKey, { state: "done", result });
    return result;
  }

  try {
    const dial = await placeCall(toDialRequest(fraudCase), {
      delayMs: input.fast ? 0 : undefined,
    });
    const outcome = composeOutcome(fraudCase, dial);
    const result: Extract<RunCallResult, { ok: true }> = {
      ok: true,
      status: 200,
      body: {
        outcome,
        plan: {
          maskedTo: plan.maskedTo,
          idempotencyKey: plan.idempotencyKey,
          provider: "calle-stub",
        },
      },
    };
    claims.set(plan.idempotencyKey, { state: "done", result });
    return result;
  } catch (err) {
    claims.delete(plan.idempotencyKey);
    return {
      ok: false,
      status: 500,
      body: { error: err instanceof Error ? err.message : "call failed" },
    };
  }
}
