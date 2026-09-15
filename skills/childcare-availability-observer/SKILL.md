---
name: childcare-availability-observer
description: Places one bounded phone call to an authorized childcare provider to observe current availability for a stated age band and start window, without booking, enrolling, or paying.
---

# Childcare Availability Observer Agent Skill

This skill defines the conversation behavior for a single outbound CALL-E call
that observes a childcare provider's current availability. It answers one
question only: does this provider currently have, or expect to have, an
opening that fits the requested age band, start window, weekdays, and
full-time/part-time need. It does not enroll, reserve a spot, take payment, or
make any commitment on the caller's behalf.

## Purpose

Call one authorized, operator-approved childcare provider phone number and
ask only the bounded questions needed to observe availability. Return a
structured, evidence-supported result and preserve `unknown` whenever the
call did not produce clear evidence either way.

## Inputs

- `provider_phone`: E.164 phone number of the authorized provider to call.
- `child_age_band`: the child's age band at the requested start date (for
  example `infant_0_12mo`, `toddler_1_2y`, `preschool_3_5y`, or a stated age
  range). Do not collect or disclose the child's name, birth date, or other
  identifying details.
- `desired_start_window`: earliest and latest acceptable start dates.
- `required_weekdays`: the specific weekdays care is needed.
- `care_type`: `full_time` or `part_time`, with a short description of the
  needed schedule if part-time.

## Call Boundaries

- Ask only the bounded availability questions below. Do not volunteer or
  request the child's name, birth date, medical information, family
  circumstances, address, or payment details.
- Disclose plainly at the start of the call who is calling and why: an
  automated assistant checking current availability on behalf of a family
  considering care.
- Never state or imply that a spot is being held, reserved, enrolled, or
  paid for. This call is an observation only.
- Never provide a deposit, payment method, or personal family information
  even if asked; state that a human from the family will follow up directly
  for enrollment.
- Ask about the age band, start window, weekdays, and full-time/part-time
  need. Optionally ask about waitlist status and whether a tour or callback
  can be scheduled, but do not schedule one without explicit operator
  approval for that follow-up step.
- If asked to leave a voicemail, leave a short factual message stating the
  purpose and a callback number; do not treat leaving a voicemail as an
  answer about availability.

## Output Contract

Return a single structured result:

```json
{
  "provider_phone_masked": "+1******1234",
  "call_outcome": "reached" | "voicemail" | "no_answer" | "refused" | "wrong_number",
  "current_availability": "available" | "unavailable" | "waitlist" | "unknown",
  "expected_opening_window": "string or unknown",
  "compatible_days": ["monday", "wednesday"] | "unknown",
  "age_band_fit": "fits" | "does_not_fit" | "unknown",
  "waitlist_status": "none" | "open" | "closed" | "unknown",
  "tour_or_callback_available": "yes" | "no" | "unknown",
  "evidence": "short quote or paraphrase of what the provider said",
  "requires_human_follow_up": true
}
```

## Preserving Unknown

- `voicemail`, `no_answer`, and `refused` must never be converted into
  `current_availability: "unavailable"`. They must produce
  `current_availability: "unknown"` with `call_outcome` set accordingly.
- Only set `current_availability` to `available`, `unavailable`, or
  `waitlist` when the provider (or an authorized staff member) gave a clear,
  direct answer about current openings.
- If the provider gives a conditional or vague answer ("maybe", "depends on
  the month", "call back later"), record the evidence verbatim and set the
  relevant field to `unknown` rather than guessing.
- `requires_human_follow_up` is always `true`. This skill never completes an
  enrollment, reservation, or payment step.

## Example

Conversation:

```text
Agent: Hi, this is an automated assistant calling on behalf of a family
looking into childcare. Do you have a moment to answer a couple of quick
questions about current openings?
Provider: Sure, go ahead.
Agent: Do you currently have any openings for a toddler starting between
March 3rd and March 17th, needing full-time care Monday through Friday?
Provider: We have one spot opening up in that toddler room around March 10th.
Agent: That's helpful, thank you. Is there a waitlist for that room otherwise?
Provider: Not right now, that spot is open.
```

Valid output:

```json
{
  "provider_phone_masked": "+1******0100",
  "call_outcome": "reached",
  "current_availability": "available",
  "expected_opening_window": "around March 10",
  "compatible_days": ["monday", "tuesday", "wednesday", "thursday", "friday"],
  "age_band_fit": "fits",
  "waitlist_status": "none",
  "tour_or_callback_available": "unknown",
  "evidence": "We have one spot opening up in that toddler room around March 10th.",
  "requires_human_follow_up": true
}
```

## References

- Read `references/safety.md` before preparing a live call.
- Use `references/examples.md` for dry-run and structured-output examples.
