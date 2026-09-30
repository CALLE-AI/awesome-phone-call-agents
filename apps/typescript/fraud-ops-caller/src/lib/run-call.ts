import "server-only";

import { placeCall, toDialRequest } from "./calle";
import { getCase } from "./cases";
import {
  deleteClaim,
  getClaim,
  getHalt,
  haltCase,
  resetClaimsStore,
  setClaim,
} from "./claims-store";
import { isApprovedCalleOrigin } from "./calle-origin";
import { failClosed } from "./map-live-result";
import { maskOutcomeForBrowser } from "./mask-public";
import { composeOutcome, composeOutcomeOrUnknown } from "./outcome";
import { verifyLiveGrant } from "./ops-auth";
import { buildCallPlan } from "./plan";
import type { FraudOpsOutcome } from "./types";

export const LIVE_CONFIRM_PHRASE = "I understand this places a real phone call";
export { isApprovedCalleOrigin } from "./calle-origin";

export function resetIdempotencyForTests(): void {
  resetClaimsStore();
}

export function isLiveAvailable(): boolean {
  return Boolean(
    process.env.CALLE_API_KEY?.trim() &&
      isApprovedCalleOrigin(process.env.CALLE_BASE_URL) &&
      process.env.CALLE_LIVE_CALLS_ENABLED === "true"
  );
}

export function liveDialAllowlist(): string[] | null {
  const raw = process.env.LIVE_DIAL_ALLOWLIST?.trim();
  if (!raw) return null;
  const list = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length ? list : null;
}

export function isAmbiguousOutcome(outcome: FraudOpsOutcome): boolean {
  return outcome.fields.handoff_reason === "outcome_unknown";
}

export type RunCallInput = {
  caseId: string;
  mode: "demo" | "live";
  confirmLive?: string;
  /** If present, must equal the case's approved phone_e164. */
  to?: string;
  liveGrant?: string;
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

/** Durable claim identity: case + approved destination + plan key. */
export function durableClaimKey(
  caseId: string,
  destination: string,
  planKey: string
): string {
  return `${caseId}|${destination}|${planKey}`;
}

function publicResult(
  result: Extract<RunCallResult, { ok: true }>
): Extract<RunCallResult, { ok: true }> {
  return {
    ...result,
    body: {
      ...result.body,
      outcome: maskOutcomeForBrowser(result.body.outcome),
    },
  };
}

function destinationDenied(fraudCasePhone: string, requested?: string): RunCallResult | null {
  if (requested !== undefined && requested !== fraudCasePhone) {
    return {
      ok: false,
      status: 403,
      body: { error: "destination does not match approved phone" },
    };
  }
  const allow = liveDialAllowlist();
  if (allow && !allow.includes(fraudCasePhone)) {
    return {
      ok: false,
      status: 403,
      body: { error: "destination not on server allowlist" },
    };
  }
  return null;
}

export async function executeCallRun(input: RunCallInput): Promise<RunCallResult> {
  const fraudCase = getCase(input.caseId);
  if (!fraudCase) return { ok: false, status: 404, body: { error: "unknown caseId" } };

  const destError = destinationDenied(fraudCase.contact.phone_e164, input.to);
  if (destError) return destError;

  const plan = await buildCallPlan(fraudCase, input.now);
  if (!plan.gate.automate) {
    return {
      ok: false,
      status: 409,
      body: { error: "gate blocked", reasons: plan.gate.reasons },
    };
  }

  const halt = getHalt(fraudCase.case_id);
  if (halt) {
    return {
      ok: false,
      status: 409,
      body: { error: "halted for reconciliation", reasons: [halt.reason] },
    };
  }

  if (input.mode === "live") {
    if (!isLiveAvailable() || input.confirmLive !== LIVE_CONFIRM_PHRASE) {
      return { ok: false, status: 403, body: { error: "live call not authorized" } };
    }
    if (!verifyLiveGrant(input.liveGrant, fraudCase.case_id, fraudCase.contact.phone_e164)) {
      return { ok: false, status: 403, body: { error: "live destination grant invalid" } };
    }
  }

  const claimKey = durableClaimKey(
    fraudCase.case_id,
    fraudCase.contact.phone_e164,
    plan.idempotencyKey
  );
  const existing = getClaim(claimKey);
  if (existing?.state === "in_flight") {
    return { ok: false, status: 409, body: { error: "call already in flight" } };
  }
  if (existing?.state === "needs_reconciliation") {
    return {
      ok: false,
      status: 409,
      body: { error: "halted for reconciliation", reasons: [existing.reason] },
    };
  }
  if (existing?.state === "done") {
    return existing.result as Extract<RunCallResult, { ok: true }>;
  }

  setClaim(claimKey, {
    state: "in_flight",
    caseId: fraudCase.case_id,
    at: new Date().toISOString(),
  });

  if (input.mode === "live") {
    let outcome: FraudOpsOutcome;
    try {
      const { placeLiveCall } = await import("./calle-live");
      const dial = await placeLiveCall(fraudCase, plan);
      outcome = composeOutcomeOrUnknown(fraudCase, dial);
    } catch {
      outcome = composeOutcome(fraudCase, failClosed(fraudCase, "outcome_unknown"));
    }
    const result = publicResult({
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
    });
    if (isAmbiguousOutcome(result.body.outcome)) {
      haltCase(fraudCase.case_id, claimKey, "outcome_unknown");
      setClaim(claimKey, {
        state: "needs_reconciliation",
        caseId: fraudCase.case_id,
        at: new Date().toISOString(),
        reason: "outcome_unknown",
        result,
      });
      return result;
    }
    setClaim(claimKey, {
      state: "done",
      caseId: fraudCase.case_id,
      at: new Date().toISOString(),
      result,
    });
    return result;
  }

  try {
    const dial = await placeCall(toDialRequest(fraudCase), {
      delayMs: input.fast ? 0 : undefined,
    });
    const outcome = composeOutcome(fraudCase, dial);
    const result = publicResult({
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
    });
    if (isAmbiguousOutcome(result.body.outcome)) {
      haltCase(fraudCase.case_id, claimKey, "outcome_unknown");
      setClaim(claimKey, {
        state: "needs_reconciliation",
        caseId: fraudCase.case_id,
        at: new Date().toISOString(),
        reason: "outcome_unknown",
        result,
      });
      return result;
    }
    setClaim(claimKey, {
      state: "done",
      caseId: fraudCase.case_id,
      at: new Date().toISOString(),
      result,
    });
    return result;
  } catch (err) {
    deleteClaim(claimKey);
    return {
      ok: false,
      status: 500,
      body: { error: err instanceof Error ? err.message : "call failed" },
    };
  }
}
