import { RankedStation, Station, StationCheckState } from "./types";

/**
 * Deterministic scoring. No LLM is used here — the CALL-E model's job ends
 * at producing a schema-valid structured_result; ranking that result against
 * the driver's requirements is plain arithmetic so the outcome is
 * inspectable and reproducible.
 *
 * IMPORTANT: everything scored here is a *call-reported* snapshot — what a
 * CALL-E-conducted phone conversation extracted — not independently
 * verified station truth. See headlineFor() and the README for the
 * language this maps to in the UI.
 *
 * Rule of thumb enforced by the point values below:
 *   reported operational + connector available + no queue  >  unknown/advertised-only
 *   a reported-unavailable station never outranks a reported-available one
 */
export function scoreStation(check: StationCheckState): number {
  const r = check.structuredResult;

  if (check.status !== "completed" || !r) {
    // Not a completed call-reported result: never treated as confirmed,
    // always ranked below any completed one. An uncertain outcome (we
    // genuinely don't know if the call happened) ranks lowest of all,
    // below a definite failure, since we have even less information about
    // it than a call we know didn't go through.
    if (check.outcomeUncertain) return -15;
    return check.status === "failed" ? -10 : -5;
  }

  let score = 0;

  if (r.operational === "yes") score += 40;
  else if (r.operational === "no") score -= 100; // reported out of service must not outrank a reported-available one
  // "unknown" contributes 0 — neither confirmed working nor confirmed down

  if (r.requested_connector_available === "yes") score += 30;
  else if (r.requested_connector_available === "no") score -= 60;

  if (r.available_chargers !== null && r.available_chargers > 0) score += 15;

  if (r.queue_present === "no") score += 10;
  else if (r.queue_present === "yes") {
    score -= 5;
    if (r.estimated_wait_minutes !== null && r.estimated_wait_minutes >= 0) {
      score -= Math.min(r.estimated_wait_minutes / 5, 10);
    }
  }

  if (r.accessibility && !/block|closed|construction/i.test(r.accessibility)) {
    score += 5;
  }

  if (r.answered_by === "human") score += 5;
  else if (r.answered_by === "voicemail" || r.answered_by === "ivr") score -= 5;

  // Confidence acts as a small tiebreaker only, never a primary driver.
  if (check.completionConfidence !== null) {
    score += check.completionConfidence * 3;
  }

  return score;
}

/**
 * Every string here describes what was *reported on the call*, not an
 * independently verified fact about the station — "Reported available now"
 * rather than "Available now", "Could not confirm via call" rather than
 * "Could not verify". This matters because the underlying data is itself
 * an AI's extraction from a phone conversation with whoever answered, not
 * a direct read of the charger's own state.
 */
export function headlineFor(check: StationCheckState): string {
  const r = check.structuredResult;
  if (check.status === "queued" || check.status === "in_progress") return "Checking…";
  if (check.outcomeUncertain) return "Uncertain — could not confirm call outcome";
  if (check.status === "failed") return "Could not confirm via call";
  if (check.status === "canceled") return "Check canceled";
  if (!r) return "Could not confirm via call";

  if (r.operational === "no") return "Reported out of service";
  if (r.requested_connector_available === "no") return "Reported connector unavailable";
  if (r.requested_connector_available === "unknown" || r.operational === "unknown")
    return "Partially confirmed by call";
  if (r.queue_present === "yes") {
    const wait =
      r.estimated_wait_minutes !== null && r.estimated_wait_minutes >= 0
        ? `${r.estimated_wait_minutes} min wait`
        : "vehicle waiting";
    return `Reported available soon — ${wait}`;
  }
  return "Reported available now";
}

export function rankStations(
  stations: Station[],
  checks: Record<string, StationCheckState>,
): RankedStation[] {
  const ranked: RankedStation[] = stations.map((station) => {
    const check = checks[station.id];
    return {
      station,
      check,
      score: scoreStation(check),
      reported: check?.status === "completed" && !!check.structuredResult && !check.outcomeUncertain,
      headline: headlineFor(check),
    };
  });

  return ranked.sort((a, b) => b.score - a.score);
}
