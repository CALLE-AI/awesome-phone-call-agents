import { classifyResult } from "./classify";
import type { Caller } from "./calle";
import { mayCall } from "./safety";
import type { Candidate, LineCallResult, SearchSpec, Verdict } from "./types";

/**
 * Wave dispatch engine.
 *
 * The CALL-E Calls API exposes no cancellation; in-flight calls run to
 * completion. So we dispatch in controlled waves against a confirmation
 * target and stop creating new calls once the target is met. This is the
 * documented CALL-E pattern and the safety-correct one.
 */

export interface DispatchOptions {
  caller: Caller;
  candidates: Candidate[];
  spec: SearchSpec;
  idempotencyPrefix: string;
  /** Stop once this many open verdicts are confirmed. */
  targetOpen: number;
  waveSize?: number;
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
  reason: "target_reached" | "exhausted" | "error";
  error?: string;
}

export async function dispatchWave(options: DispatchOptions): Promise<DispatchResult> {
  const {
    caller,
    candidates,
    spec,
    idempotencyPrefix,
    targetOpen,
    runKey,
    isOptedOut = () => false,
    lastCalledAt = () => null,
    onResult,
  } = options;
  const now = options.now ?? new Date();
  const waveSize = options.waveSize ?? 5;

  const results: LineCallResult[] = [];
  let openFound = 0;
  let stopReason: DispatchResult["reason"] = "exhausted";
  let error: string | undefined;

  for (let i = 0; i < candidates.length && stopReason === "exhausted"; i += waveSize) {
    const wave = candidates.slice(i, i + waveSize);

    const batch = await Promise.all(
      wave.map(async (candidate) => {
        const gate = mayCall(candidate, lastCalledAt(candidate.phoneE164), isOptedOut(candidate.phoneE164), now);
        if (!gate.allow) {
          return blockedResult(candidate, gate.reason ?? "blocked");
        }

        const idempotencyKey = `${idempotencyPrefix}:${runKey}:${candidate.id}`;
        try {
          const output = await caller.placeCall({
            candidate,
            spec,
            idempotencyKey,
          });
          const verdict: Verdict =
            output.result == null ? "unreachable" : classifyResult(output.result);
          return {
            candidateId: candidate.id,
            verdict,
            evidence: output.result?.evidence_quote ?? output.evidence[0] ?? "",
            raw: output.result,
            summary: output.summary,
            calleCallId: output.callId,
            completedAt: new Date().toISOString(),
            calleStatus: output.calleStatus,
          } satisfies LineCallResult;
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
          return blockedResult(candidate, "call_error");
        }
      }),
    );

    for (const result of batch) {
      results.push(result);
      onResult?.(result);
      if (result.verdict === "open") openFound += 1;
    }

    if (openFound >= targetOpen) {
      stopReason = "target_reached";
    }
  }

  return { results, openFound, reason: error ? "error" : stopReason, error };
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
