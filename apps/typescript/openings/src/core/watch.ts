import type { DispatchResult } from "./dispatch";
import type { WatchStats } from "./types";

/**
 * The standing watch. Per the repository's Design Principle 1, the host owns
 * recurrence and CALL-E places exactly one call per scheduled run. The watch
 * re-calls practices on a decaying cadence until a target number of openings
 * is found, or the user stops it. Cancellation is first-class.
 */

export function statsFromResults(results: DispatchResult["results"]): WatchStats {
  const stats: WatchStats = {
    called: 0,
    reached: 0,
    open: 0,
    waitlist: 0,
    notAccepting: 0,
    ghost: 0,
    unreachable: 0,
    inconclusive: 0,
    declined: 0,
    error: 0,
    blocked: 0,
  };
  for (const r of results) {
    if (r.verdict !== "blocked") stats.called += 1;
    switch (r.verdict) {
      case "open":
        stats.open += 1;
        stats.reached += 1;
        break;
      case "waitlist":
        stats.waitlist += 1;
        stats.reached += 1;
        break;
      case "not_accepting":
        stats.notAccepting += 1;
        stats.reached += 1;
        break;
      case "ghost":
        stats.ghost += 1;
        break;
      case "unreachable":
        stats.unreachable += 1;
        break;
      case "inconclusive":
        stats.inconclusive += 1;
        stats.reached += 1;
        break;
      case "declined":
        stats.declined += 1;
        stats.reached += 1;
        break;
      case "error":
        stats.error += 1;
        break;
      case "blocked":
        stats.blocked += 1;
        break;
    }
  }
  return stats;
}

export const CADENCE_HOURS = [1, 3, 7, 14, 24, 48, 72, 168] as const;

/** Decaying cadence: 1h, 3h, 7h, 14h, 24h, then weekly-ish. */
export function cadenceForRun(runNumber: number): number {
  if (runNumber < 1) return CADENCE_HOURS[0]!;
  const idx = Math.min(runNumber, CADENCE_HOURS.length) - 1;
  return CADENCE_HOURS[idx]!;
}
