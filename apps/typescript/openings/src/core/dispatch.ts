import { classifyResult } from "./classify";
import type { Caller } from "./calle";
import { mayCall } from "./safety";
import type { Candidate, LineCallResult, SearchSpec, Verdict } from "./types";

/**
 * Sequential dispatch engine.
 *
 * Calls are placed strictly ONE AT A TIME. Cancellation is observed
 * immediately before every single call, so Stop during an in-flight call
 * prevents every subsequent live call — there is no pre-launched batch that
 * can keep dialing after the user stops the watch.
 *
 * A hard per-run cap bounds spend even when the target is never reached, and
 * any ambiguous provider result fails closed: it stops the run and (at the
 * app layer) stops the watch.
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
  /** Hard cap on calls placed in this run. Gate-blocked candidates do not count. */
  maxCalls?: number;
  /** Idempotency key to reuse (the same run), used for retries. */
  runKey: string;
  /** Lookup: whether a practice has opted out. */
  isOptedOut?: (phoneE164: string) => boolean;
  /** Lookup: last call time per number, for cooldown checks. */
  lastCalledAt?: (phoneE164: string) => Date | null;
  /**
   * Cancellation check, consulted immediately before every new call so Stop
   * prevents later calls from an already-running dispatch.
   */
  isCancelled?: () => boolean;
  now?: Date;
  onResult?: (result: LineCallResult) => void;
}

export interface DispatchResult {
  results: LineCallResult[];
  openFound: number;
  /** Why the dispatch stopped. */
  reason: "target_reached" | "exhausted" | "error" | "call_cap_reached" | "cancelled";
  error?: string;
}

export async function dispatchRun(options: DispatchOptions): Promise<DispatchResult> {
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
    isCancelled = () => false,
    onResult,
  } = options;
  const now = options.now ?? new Date();

  const results: LineCallResult[] = [];
  let openFound = 0;
  let callsPlaced = 0;
  let hitError: string | undefined;
  let hitCap = false;
  let cancelled = false;

  for (const candidate of candidates) {
    // Cancellation is observed immediately before every single call, so Stop
    // prevents later calls from an already-running dispatch.
    if (isCancelled()) {
      cancelled = true;
      break;
    }
    // No budget left: stop creating calls. Blocked candidates do not count.
    if (maxCalls != null && callsPlaced >= maxCalls) {
      hitCap = true;
      break;
    }

    const gate = mayCall(candidate, lastCalledAt(candidate.phoneE164), isOptedOut(candidate.phoneE164), now);
    if (!gate.allow) {
      // Never dialed: does not consume the run's call budget.
      const blocked = blockedResult(candidate, gate.reason ?? "blocked");
      results.push(blocked);
      onResult?.(blocked);
      continue;
    }

    const idempotencyKey = `${idempotencyPrefix}:${runKey}:${candidate.id}`;
    let result: LineCallResult;
    try {
      const output = await caller.placeCall({
        candidate,
        spec,
        idempotencyKey,
        watchId,
      });

      // Simulated callers (dry-run/fake) never dial, so their results are
      // advisory by definition: classify them normally but they can never
      // be provider-verified evidence.
      if (output.simulated) {
        if (output.result == null) {
          hitError = hitError ?? `simulated_missing_result:${candidate.id}`;
          result = errorResult(candidate, "simulated_missing_result");
          results.push(result);
          onResult?.(result);
          callsPlaced += 1;
          break;
        }
        const verdict: Verdict = classifyResult(output.result);
        result = {
          candidateId: candidate.id,
          phoneE164: candidate.phoneE164,
          verdict,
          evidence: output.result.evidence_quote ?? output.evidence[0] ?? "",
          raw: output.result,
          summary: output.summary,
          calleCallId: output.callId,
          completedAt: new Date().toISOString(),
          calleStatus: output.calleStatus,
        };
      } else {
        // Live calls require a terminal verified result bound to the exact
        // call/task/recipient/watch before any availability can be treated as
        // verified. Unverified or non-terminal results are ambiguous and must
        // fail closed: they become an `error` verdict that stops this run and
        // (at the app layer) stops the watch.
        const isVerifiedTerminal =
          output.verified && output.completed && output.calleStatus === "completed" && output.result !== null;
        if (!isVerifiedTerminal) {
          const reason = !output.verified
            ? "unverified_result"
            : !output.completed || output.calleStatus !== "completed"
              ? `not_terminal:${output.calleStatus ?? "unknown"}`
              : "missing_result";
          hitError = hitError ?? `${reason}:${candidate.id}`;
          result = errorResult(candidate, reason);
        } else {
          const verdict: Verdict = classifyResult(output.result!);
          result = {
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
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      hitError = msg;
      // A call may have been created before it failed; count it against
      // the budget conservatively. Distinct from `blocked` (which means
      // we deliberately did not dial).
      result = errorResult(candidate, msg);
    }

    results.push(result);
    callsPlaced += 1;
    onResult?.(result);
    if (result.verdict === "open") openFound += 1;

    // Fail closed: stop creating calls after any ambiguous outcome.
    if (hitError) break;
    if (openFound >= targetOpen) break;
  }

  // Precedence: a confirmed target is the strongest signal, then errors, then
  // cancellation, then an exhausted call budget, then simply running out of
  // candidates.
  let reason: DispatchResult["reason"] = "exhausted";
  if (openFound >= targetOpen) reason = "target_reached";
  else if (hitError) reason = "error";
  else if (cancelled) reason = "cancelled";
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
