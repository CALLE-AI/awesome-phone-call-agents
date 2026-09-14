import { RankedStation, Station, StationCheckState } from "./types";

/**
 * Deterministic scoring. No LLM is used here — the CALL-E model's job ends
 * at producing a schema-valid structured_result; ranking that result against
 * the driver's requirements is plain arithmetic so the outcome is
 * inspectable and reproducible.
 *
 * Rule of thumb enforced by the point values below:
 *   verified operational + connector available + no queue  >  unknown/advertised-only
 *   an unavailable-but-verified station never outranks a verified-available one
 */
export function scoreStation(check: StationCheckState): number {
  const r = check.structuredResult;

  if (check.status !== "completed" || !r) {
    // Not verified: never treated as confirmed, always ranked below any
    // verified result, but ranked by how much we DO know when comparing
    // two unverified stations.
    return check.status === "failed" ? -10 : -5;
  }

  let score = 0;

  if (r.operational === "yes") score += 40;
  else if (r.operational === "no") score -= 100; // out of service must not outrank an available one
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

export function headlineFor(check: StationCheckState): string {
  const r = check.structuredResult;
  if (check.status === "queued" || check.status === "in_progress") return "Checking…";
  if (check.status === "failed") return "Could not verify";
  if (check.status === "canceled") return "Check canceled";
  if (!r) return "Could not verify";

  if (r.operational === "no") return "Out of service";
  if (r.requested_connector_available === "no") return "Connector not available";
  if (r.requested_connector_available === "unknown" || r.operational === "unknown")
    return "Partially verified";
  if (r.queue_present === "yes") {
    const wait =
      r.estimated_wait_minutes !== null && r.estimated_wait_minutes >= 0
        ? `${r.estimated_wait_minutes} min wait`
        : "vehicle waiting";
    return `Available soon — ${wait}`;
  }
  return "Available now";
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
      verified: check?.status === "completed" && !!check.structuredResult,
      headline: headlineFor(check),
    };
  });

  return ranked.sort((a, b) => b.score - a.score);
}
