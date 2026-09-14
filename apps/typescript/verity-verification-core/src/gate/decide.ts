// src/gate/decide.ts — the pure policy engine (PRD §6, ARCH §4.6, DECISIONS T2).
// decide(GateInput): Decision. NO I/O. NO imports from integration/, db/, sandbox/, sms/.
// Ordered BLOCK checks (§6.3 rows 1..16, first match wins), then E1–E7, then ALLOW.
// A total try/catch returns BLOCK — there is no path from a throw to ALLOW (§6.10).

import type { BookingValue, Decision, GateInput, ResolvedDateTime } from "../domain/types.js";
import { equalsDateTime, resolvedToBookingValue } from "../domain/booking.js";
import { targetFor, e1_claimPresent, e2_singleTarget, e3_parsedMatchesTarget, e4_explicitConfirmation, e5_noOpenAmbiguity, e6_slotStillOurs, e7_noBlockingFixture } from "./evidence.js";

function bv(i: GateInput, rt: ResolvedDateTime): BookingValue {
  return resolvedToBookingValue(rt, i.intended_value.service_type);
}
function bestParsed(i: GateInput): BookingValue | null {
  const first = i.parsed.resolved_targets[0];
  return first ? bv(i, first) : null;
}
const block = (
  reason_code: string,
  reason_detail: string,
  repair_target: BookingValue | null,
  extra: Partial<Decision> = {},
): Decision => ({
  decision: "BLOCK",
  reason_code,
  reason_detail,
  repair_target,
  ghost_booking_prevented: false,
  evidence_refs: null,
  ...extra,
});

function firstBlock(i: GateInput): Decision | null {
  const holdValue = i.original_hold.value;
  const target = targetFor(i);
  const first = i.parsed.resolved_targets[0];
  const has = (flag: string): boolean => i.ambiguity.flags.includes(flag as never);
  const fixture = (b: string) => i.matched_fixtures.find((f) => f.expected_behavior === b);

  // 1
  if (i.slot_recheck.sandbox_ok === false)
    return block("sandbox_unavailable", "slot re-check reported the sandbox unavailable", null);
  // 2
  if (i.calle.status !== "completed")
    return block("call_not_completed", `calle.status=${i.calle.status}`, null);
  // 3
  if (i.calle.task_completed !== true)
    return block("claim_absent", `task_completed=${String(i.calle.task_completed)}`, bestParsed(i) ?? holdValue);
  // 4
  if (i.calle.completion_confidence?.label === "low")
    return block("claim_low_confidence", "completion_confidence.label=low", bestParsed(i));
  // 5
  if (i.parsed.partial === true)
    return block(
      "transcript_partial",
      "transcript is partial / truncated / has no caller turn",
      i.intent === "confirm" ? holdValue : null,
    );
  // 6
  if (fixture("block_hard"))
    return block("fixture_block", `fixture ${fixture("block_hard")!.fixture_id} demands a hard block`, null, {
      evidence_refs: { fixture_id: fixture("block_hard")!.fixture_id },
    });
  // 7
  if (fixture("force_sms_confirmation"))
    return block(
      "fixture_force_sms",
      `fixture ${fixture("force_sms_confirmation")!.fixture_id} demands SMS confirmation`,
      bestParsed(i) ?? holdValue,
      { evidence_refs: { fixture_id: fixture("force_sms_confirmation")!.fixture_id } },
    );
  // 8
  if (has("self_correction_unresolved"))
    return block("self_correction", "unresolved self-correction with no re-confirmation", bestParsed(i), {
      evidence_refs: { parsed_field: "resolved_targets[0]" },
    });
  // 9
  if (has("multi_time_mention_unresolved")) {
    const matchesIntended =
      first && first.time === i.intended_value.appointment_time ? bv(i, first) : null;
    return block("multi_time_mention", "multiple times in one utterance, none agreed", matchesIntended);
  }
  // 10
  if (has("relative_date_ambiguity"))
    return block("relative_date_ambiguity", "a relative date has >1 valid resolution", null);
  // 11
  if (i.parsed.resolved_targets.length === 0)
    return block("no_parseable_target", "no datetime could be parsed from the transcript", null);
  // 12
  if (i.parsed.resolved_targets.length >= 2)
    return block("multiple_targets", `${i.parsed.resolved_targets.length} distinct parsed targets`, null);
  // 13
  if (first && !equalsDateTime(first, target))
    return block("claim_parse_mismatch", "parsed value ≠ the value the booking would write", bv(i, first), {
      ghost_booking_prevented: i.calle.task_completed === true,
      evidence_refs: { parsed_field: "resolved_targets[0]", calle_field: "structured_result" },
    });
  // 14
  if (i.parsed.explicit_confirmation !== true)
    return block("no_explicit_confirmation", "no bot restatement + caller affirmative", first ? bv(i, first) : null);
  // 15
  if (i.slot_recheck.held_by_hold_id !== i.original_hold.hold_id)
    return block("slot_lost", "the slot is no longer held by our hold", holdValue);
  // 16
  if (Date.parse(i.now) >= Date.parse(i.original_hold.expires_at))
    return block("hold_expired", "the hold expired before the write", bestParsed(i) ?? holdValue);

  return null;
}

function allowOrEvidenceBlock(i: GateInput): Decision {
  if (!e1_claimPresent(i)) return block("claim_absent", "E1 failed", bestParsed(i) ?? i.original_hold.value);
  if (!e2_singleTarget(i))
    return i.parsed.resolved_targets.length === 0
      ? block("no_parseable_target", "E2 failed (0 targets)", null)
      : block("multiple_targets", "E2 failed (>1 targets)", null);
  if (!e3_parsedMatchesTarget(i))
    return block("claim_parse_mismatch", "E3 failed", bestParsed(i), {
      ghost_booking_prevented: i.calle.task_completed === true,
    });
  if (!e4_explicitConfirmation(i))
    return block("no_explicit_confirmation", "E4 failed", bestParsed(i));
  if (!e5_noOpenAmbiguity(i)) return block("self_correction", "E5 failed", bestParsed(i));
  if (!e6_slotStillOurs(i))
    return Date.parse(i.now) >= Date.parse(i.original_hold.expires_at)
      ? block("hold_expired", "E6 failed (expired)", bestParsed(i) ?? i.original_hold.value)
      : block("slot_lost", "E6 failed (not our hold / sandbox)", i.original_hold.value);
  if (!e7_noBlockingFixture(i)) return block("fixture_force_sms", "E7 failed", bestParsed(i));

  return {
    decision: "ALLOW",
    reason_code: "allow_clean",
    reason_detail: "E1–E7 all satisfied",
    repair_target: null,
    ghost_booking_prevented: false,
    evidence_refs: {
      transcript_turn_indexes:
        i.parsed.confirmation_turn_index !== null ? [i.parsed.confirmation_turn_index] : [],
      parsed_field: "resolved_targets[0]",
    },
  };
}

export function decide(input: GateInput): Decision {
  try {
    const d = firstBlock(input) ?? allowOrEvidenceBlock(input);
    // ghost_booking_prevented: CALL-E claimed success but Verity caught, first-hand, that
    // the parsed value ≠ what the booking would write. It is a property of the evidence,
    // not of which BLOCK row won (B blocks on `self_correction`, not `claim_parse_mismatch`
    // — PRD §6.3 row 13 note, §7.3, DEMO step 3). Learned-pattern blocks (fixture_*) and
    // "value was right, just unconfirmed" (no_explicit_confirmation) do NOT count.
    const FRESH_CATCH = new Set(["claim_parse_mismatch", "self_correction", "multi_time_mention"]);
    if (d.decision === "BLOCK" && !d.ghost_booking_prevented && FRESH_CATCH.has(d.reason_code)) {
      const first = input.parsed.resolved_targets[0];
      if (first && input.calle.task_completed === true && !equalsDateTime(first, targetFor(input))) {
        return { ...d, ghost_booking_prevented: true };
      }
    }
    return d;
  } catch (e) {
    return {
      decision: "BLOCK",
      reason_code: "sandbox_unavailable",
      reason_detail: `gate_exception:${e instanceof Error ? e.message : String(e)}`,
      repair_target: null,
      ghost_booking_prevented: false,
      evidence_refs: null,
    };
  }
}
