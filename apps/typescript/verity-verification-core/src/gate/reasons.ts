// src/gate/reasons.ts — the stable reason_code enum (PRD §6.4).
// The dashboard, the metrics view, and the regression-fixture lifecycle all key on these.

export const REASON_CODES = [
  "sandbox_unavailable",
  "call_not_completed",
  "claim_absent",
  "claim_low_confidence",
  "transcript_partial",
  "fixture_block",
  "fixture_force_sms",
  "self_correction",
  "multi_time_mention",
  "relative_date_ambiguity",
  "no_parseable_target",
  "multiple_targets",
  "claim_parse_mismatch",
  "no_explicit_confirmation",
  "slot_lost",
  "hold_expired",
  "allow_clean",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];
