// src/ambiguity/detect.ts — turn ParsedTranscript into typed risk flags (PRD §6.6, ARCH §4.4).
// Pure. The gate consumes flags + matched_fixtures and picks the first BLOCK reason by order.

import type {
  AmbiguityFlag,
  AmbiguityReport,
  BookingValue,
  Intent,
  ParsedTranscript,
} from "../domain/types.js";
import { equalsDateTime, expectedTarget } from "../domain/booking.js";

export interface DetectInput {
  parsed: ParsedTranscript;
  intent: Intent;
  intended_value: BookingValue;
  original_hold_value: BookingValue;
  /** fixture ids that matched the transcript (computed by the pipeline — ARCH §4.8). */
  matched_fixture_ids?: string[];
}

export function detect(input: DetectInput): AmbiguityReport {
  const { parsed } = input;
  const target = expectedTarget(input.intent, input.intended_value, input.original_hold_value);
  const flags: AmbiguityFlag[] = [];
  const details: Record<string, unknown> = {};

  // relative_date_ambiguity — any candidate that resolves >1 valid calendar date
  if (parsed.candidate_datetimes.some((c) => (c.relative_resolutions?.length ?? 0) > 1)) {
    flags.push("relative_date_ambiguity");
  }

  // self_correction_unresolved — a correction cue with no re-confirmation of the new value
  if (parsed.correction_events.length > 0 && !parsed.explicit_confirmation) {
    flags.push("self_correction_unresolved");
  }

  // multi_time_mention_unresolved — ≥2 distinct times in one user turn, none == target time
  const byTurn = new Map<number, Set<string>>();
  for (const c of parsed.candidate_datetimes) {
    if (c.speaker !== "user" || !c.resolved) continue;
    const set = byTurn.get(c.turn_index) ?? new Set<string>();
    set.add(c.resolved.time);
    byTurn.set(c.turn_index, set);
  }
  for (const [turn_index, times] of byTurn) {
    if (times.size >= 2 && !times.has(target.appointment_time)) {
      flags.push("multi_time_mention_unresolved");
      details.multi_time_turn = turn_index;
      break;
    }
  }

  // no_explicit_confirmation — a parsed value that nobody affirmed (primary case: no correction)
  if (
    !parsed.explicit_confirmation &&
    parsed.correction_events.length === 0 &&
    parsed.resolved_targets.length > 0
  ) {
    flags.push("no_explicit_confirmation");
  }

  // claim_parse_mismatch — the independently parsed value ≠ what the booking would write
  const first = parsed.resolved_targets[0];
  if (first && !equalsDateTime(first, target)) {
    flags.push("claim_parse_mismatch");
    details.parsed_first = first;
    details.expected_target = target;
  }

  return { flags, matched_fixture_ids: input.matched_fixture_ids ?? [], details };
}
