// src/gate/evidence.ts — E1–E7 required-evidence predicates (PRD §6.2).
// Each is independently testable. E1 is "necessary, never sufficient" (SECURITY §7).

import type { GateInput } from "../domain/types.js";
import { equalsDateTime, expectedTarget } from "../domain/booking.js";

export function targetFor(input: GateInput) {
  return expectedTarget(input.intent, input.intended_value, input.original_hold.value);
}

/** E1 — the claim is present and not self-rated low. */
export function e1_claimPresent(i: GateInput): boolean {
  return i.calle.task_completed === true && i.calle.completion_confidence?.label !== "low";
}

/** E2 — the transcript points to exactly one datetime after self-correction. */
export function e2_singleTarget(i: GateInput): boolean {
  return i.parsed.resolved_targets.length === 1;
}

/** E3 — the parsed value equals what the booking would write (date+time+tz, exact). */
export function e3_parsedMatchesTarget(i: GateInput): boolean {
  const first = i.parsed.resolved_targets[0];
  return !!first && equalsDateTime(first, targetFor(i));
}

/** E4 — a strict in-transcript confirmation of the full value. */
export function e4_explicitConfirmation(i: GateInput): boolean {
  return i.parsed.explicit_confirmation === true;
}

/** E5 — no open ambiguity flag. */
export function e5_noOpenAmbiguity(i: GateInput): boolean {
  const bad = new Set([
    "self_correction_unresolved",
    "multi_time_mention_unresolved",
    "relative_date_ambiguity",
    "no_explicit_confirmation",
    "claim_parse_mismatch",
  ]);
  return !i.ambiguity.flags.some((f) => bad.has(f));
}

/** E6 — the slot is still ours and unexpired at write time. */
export function e6_slotStillOurs(i: GateInput): boolean {
  return (
    i.slot_recheck.sandbox_ok === true &&
    i.slot_recheck.held_by_hold_id === i.original_hold.hold_id &&
    Date.parse(i.now) < Date.parse(i.original_hold.expires_at)
  );
}

/** E7 — no learned failure shape demands SMS or a hard block. */
export function e7_noBlockingFixture(i: GateInput): boolean {
  return !i.matched_fixtures.some(
    (f) => f.expected_behavior === "force_sms_confirmation" || f.expected_behavior === "block_hard",
  );
}

export const ALL_EVIDENCE = [
  ["E1", e1_claimPresent],
  ["E2", e2_singleTarget],
  ["E3", e3_parsedMatchesTarget],
  ["E4", e4_explicitConfirmation],
  ["E5", e5_noOpenAmbiguity],
  ["E6", e6_slotStillOurs],
  ["E7", e7_noBlockingFixture],
] as const;
