/**
 * Regression detection against the baseline history.
 *
 * Deterministic rules, tuned to stay quiet on short histories:
 *
 * - `new_failure`      last run passed, this one did not.
 * - `still_failing`    this and the previous run both failed.
 * - `recovered`        last run failed, this one passed.
 * - `assertion_regressed`  an assertion that passed in the most recent pass
 *                      run fails now (named by path).
 * - `timing_regressed` secondsToAnswer exceeds max(2 × median, median + 10s)
 *                      over the last 10 pass runs — both guards, so a 2s
 *                      baseline doesn't page at 5s.
 * - `confidence_dropped`  confidence below the pass-run median − 0.2.
 *
 * An empty history produces nothing: the first run IS the baseline.
 */

import type { CheckOutcome } from "./assert.js";

export interface Regression {
  checkId: string;
  kind: "new_failure" | "assertion_regressed" | "timing_regressed" | "confidence_dropped" | "still_failing" | "recovered";
  detail: string;
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function assertionKey(entry: CheckOutcome["assertions"][number]): string {
  return JSON.stringify(entry.assertion);
}

export function diffAgainstBaseline(outcome: CheckOutcome, history: CheckOutcome[]): Regression[] {
  if (history.length === 0) {
    return [];
  }
  const regressions: Regression[] = [];
  const previous = history[history.length - 1];
  const failedNow = outcome.status !== "pass";
  const failedBefore = previous.status !== "pass";

  if (failedNow && !failedBefore) {
    const cause =
      outcome.status === "error"
        ? `call error: ${outcome.failureCode ?? "unknown"}`
        : [
            ...outcome.assertions.filter((entry) => !entry.pass).map((entry) => `${entry.assertion.path}: ${entry.detail}`),
            ...outcome.timingViolations,
            ...(outcome.confidenceViolation === null ? [] : [outcome.confidenceViolation]),
          ].join("; ");
    regressions.push({ checkId: outcome.checkId, kind: "new_failure", detail: cause });
  } else if (failedNow && failedBefore) {
    regressions.push({
      checkId: outcome.checkId,
      kind: "still_failing",
      detail: `failing since at least ${previous.at}`,
    });
  } else if (!failedNow && failedBefore) {
    regressions.push({ checkId: outcome.checkId, kind: "recovered", detail: `recovered at ${outcome.at}` });
  }

  const passRuns = history.filter((entry) => entry.status === "pass");

  // Assertion-level comparison against the most recent pass run only counts
  // when the run-level transition was pass → fail; otherwise it repeats noise.
  if (failedNow && !failedBefore && passRuns.length > 0) {
    const lastPass = passRuns[passRuns.length - 1];
    const passedThen = new Set(lastPass.assertions.filter((entry) => entry.pass).map(assertionKey));
    for (const entry of outcome.assertions) {
      if (!entry.pass && passedThen.has(assertionKey(entry))) {
        regressions.push({
          checkId: outcome.checkId,
          kind: "assertion_regressed",
          detail: `${entry.assertion.path}: ${entry.detail} (passed at ${lastPass.at})`,
        });
      }
    }
  }

  if (!failedNow) {
    const recentPasses = passRuns.slice(-10);
    const timingMedian = median(
      recentPasses.map((entry) => entry.timing.secondsToAnswer).filter((value): value is number => value !== null),
    );
    const current = outcome.timing.secondsToAnswer;
    if (timingMedian !== null && current !== null) {
      const threshold = Math.max(2 * timingMedian, timingMedian + 10);
      if (current > threshold) {
        regressions.push({
          checkId: outcome.checkId,
          kind: "timing_regressed",
          detail: `secondsToAnswer ${current} > ${threshold} (median ${timingMedian} over ${recentPasses.length} pass runs)`,
        });
      }
    }

    const confidenceMedian = median(
      recentPasses.map((entry) => entry.confidence).filter((value): value is number => value !== null),
    );
    if (confidenceMedian !== null && outcome.confidence !== null && outcome.confidence < confidenceMedian - 0.2) {
      regressions.push({
        checkId: outcome.checkId,
        kind: "confidence_dropped",
        detail: `confidence ${outcome.confidence} < median ${confidenceMedian} − 0.2`,
      });
    }
  }

  return regressions;
}
