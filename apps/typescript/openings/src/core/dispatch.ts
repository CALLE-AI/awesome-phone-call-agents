import { classifyResult } from "./classify";
import type { Caller } from "./calle";
import { mayCall } from "./safety";
import type { Candidate, LineCallResult, SearchSpec, Verdict } from "./types";

/**
 * Wave dispatch engine.
 *
 * The CALL-E Calls API exposes no cancellation; in-flight calls run to
 * completion. So we dispatch in controlled waves against a confirmation
 * target and stop creating new calls once the target is met. A hard per-run
 * cap bounds spend even when the target is never reached. This is the
 * documented CALL-E pattern and the safety-correct one.
 */

export interface DispatchOptions {
  caller: Caller;
  candidates: Candidate[];
  spec: SearchSpec;
  idempotencyPrefix: string;
  /** Watch id recorded on every call's metadata. */
  watchId: string;
  /** Stop once this many open verdicts are confirmed. */
  targetOpen: number;
  waveSize?: number;
  /** Hard cap on calls placed in this run. Gate-blocked candidates do not count. */
  maxCalls?: number;
  /** Idempotency key to reuse (the same run), used for retries. */
  runKey: string;
  /** Lookup: whether a practice has opted out. */
  isOptedOut?: (phoneE164: string) => boolean;
  /** Lookup: last call time per number, for cooldown checks. */
  lastCalledAt?: (phoneE164: string) => Date | null;
  now?: Date;
  onResult?: (result: LineCallResult) => void;
}

export interface DispatchResult {
  results: LineCallResult[];
  openFound: number;
  /** Why the dispatch stopped. */
  reason: "target_reached" | "exhausted" | "error" | "call_cap_reached";
  error?: string;
}

export async function dispatchWave(options: DispatchOptions): Promise<DispatchResult> {
  const {
    caller,
    candidates,
    spec,
    idempotencyPrefix,
    watchId,
    targetOpen,
    runKey,
    maxCalls,
    isOptedOut = () => false,
    lastCalledAt = () => null,
    onResult,
  } = options;
  const now = options.now ?? new Date();
  const waveSize = options.waveSize ?? 5;

  const results: LineCallResult[] = [];
  let openFound = 0;
  let callsPlaced = 0;
  let hitError: string | undefined;
  let hitCap = false;
  let index = 0;

  while (index < candidates.length) {
    // No budget left: stop creating calls. Blocked candidates do not count.
    if (maxCalls != null && callsPlaced >= maxCalls) {
      hitCap = true;
      break;
    }
    const remaining = maxCalls != null ? maxCalls - callsPlaced : Infinity;
    const wave = candidates.slice(index, index + Math.min(waveSize, remaining));
    index += wave.length;

    const batch = await Promise.all(
      wave.map(async (candidate) => {
        const gate = mayCall(candidate, lastCalledAt(candidate.phoneE164), isOptedOut(candidate.phoneE164), now);
        if (!gate.allow) {
          // Never dialed: must not consume the run's call budget.
          return { result: blockedResult(candidate, gate.reason ?? "blocked"), placed: false };
        }

        const idempotencyKey = `${idempotencyPrefix}:${runKey}:${candidate.id}`;
        try {
          const output = await caller.placeCall({
            candidate,
            spec,
            idempotencyKey,
            watchId,
          });
          const verdict: Verdict =
            output.result == null ? "unreachable" : classifyResult(output.result);
          const result: LineCallResult = {
            candidateId: candidate.id,
            phoneE164: candidate.phoneE164,
            verdict,
            evidence: output.result?.evidence_quote ?? output.evidence[0] ?? "",
            raw: output.result,
            summary: output.summary,
            calleCallId: output.callId,
            completedAt: new Date().toISOString(),
            calleStatus: output.calleStatus,
          };
          return { result, placed: true };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          hitError = msg;
          // A call may have been created before it failed; count it against
          // the budget conservatively. Distinct from `blocked` (which means
          // we deliberately did not dial).
          return { result: errorResult(candidate, msg), placed: true };
        }
      }),
    );

    for (const { result, placed } of batch) {
      results.push(result);
      if (placed) callsPlaced += 1;
      onResult?.(result);
      if (result.verdict === "open") openFound += 1;
    }

    if (openFound >= targetOpen) {
      break;
    }
  }

  // Precedence: a confirmed target is the strongest signal, then errors, then
  // an exhausted call budget, then simply running out of candidates.
  let reason: DispatchResult["reason"] = "exhausted";
  if (openFound >= targetOpen) reason = "target_reached";
  else if (hitError) reason = "error";
  else if (hitCap) reason = "call_cap_reached";

  return { results, openFound, reason, error: hitError };
}

function blockedResult(candidate: Candidate, reason: string): LineCallResult {
  return {
    candidateId: candidate.id,
    verdict: "blocked",
    evidence: reason,
    raw: null,
    completedAt: new Date().toISOString(),
  };
}

function errorResult(candidate: Candidate, message: string): LineCallResult {
  return {
    candidateId: candidate.id,
    phoneE164: candidate.phoneE164,
    verdict: "error",
    evidence: "call_error",
    summary: message,
    raw: null,
    completedAt: new Date().toISOString(),
  };
}
