# Childcare availability observer examples

## Dry-run / no-call preview

Input:

```text
Provider: +15550101100
Child age band: toddler_1_2y
Desired start window: 2026-03-03 to 2026-03-17
Required weekdays: monday, tuesday, wednesday, thursday, friday
Care type: full_time
Mode: dry_run
```

Expected preview (no call placed):

```json
{
  "mode": "dry_run",
  "provider_phone_masked": "+1******1100",
  "real_calls_placed": 0,
  "requires_operator_approval": true
}
```

## Reached, clear availability

Conversation excerpt:

```text
Agent: Hi, this is an automated assistant calling on behalf of a family
looking into childcare. Do you have a moment for a couple of quick
questions about current openings?
Provider: Sure.
Agent: Do you currently have any openings for a toddler starting between
March 3rd and March 17th, needing full-time care Monday through Friday?
Provider: Yes, we have one spot in that room right now.
```

Valid result:

```json
{
  "provider_phone_masked": "+1******1100",
  "call_outcome": "reached",
  "current_availability": "available",
  "expected_opening_window": "now",
  "compatible_days": ["monday", "tuesday", "wednesday", "thursday", "friday"],
  "age_band_fit": "fits",
  "waitlist_status": "none",
  "tour_or_callback_available": "unknown",
  "evidence": "Yes, we have one spot in that room right now.",
  "requires_human_follow_up": true
}
```

## Reached, waitlist only

Conversation excerpt:

```text
Provider: That room is full, but I can add the family to our waitlist.
```

Valid result:

```json
{
  "provider_phone_masked": "+1******0177",
  "call_outcome": "reached",
  "current_availability": "waitlist",
  "expected_opening_window": "unknown",
  "compatible_days": "unknown",
  "age_band_fit": "unknown",
  "waitlist_status": "open",
  "tour_or_callback_available": "unknown",
  "evidence": "That room is full, but I can add the family to our waitlist.",
  "requires_human_follow_up": true
}
```

## Voicemail (must stay unknown, not unavailable)

Call outcome: reached an answering machine, left a short factual message.

Valid result:

```json
{
  "provider_phone_masked": "+1******0199",
  "call_outcome": "voicemail",
  "current_availability": "unknown",
  "expected_opening_window": "unknown",
  "compatible_days": "unknown",
  "age_band_fit": "unknown",
  "waitlist_status": "unknown",
  "tour_or_callback_available": "unknown",
  "evidence": "Reached voicemail; left a short message stating purpose and callback number.",
  "requires_human_follow_up": true
}
```

Invalid result (do not produce this):

```json
{
  "current_availability": "unavailable"
}
```

Reaching voicemail is not evidence of unavailability.

## No answer

Valid result:

```json
{
  "provider_phone_masked": "+1******0142",
  "call_outcome": "no_answer",
  "current_availability": "unknown",
  "expected_opening_window": "unknown",
  "compatible_days": "unknown",
  "age_band_fit": "unknown",
  "waitlist_status": "unknown",
  "tour_or_callback_available": "unknown",
  "evidence": "Call was not answered after the configured number of rings.",
  "requires_human_follow_up": true
}
```

## Refusal to discuss availability by phone

Conversation excerpt:

```text
Provider: We don't give out availability information over the phone,
please email us instead.
```

Valid result:

```json
{
  "provider_phone_masked": "+1******0188",
  "call_outcome": "refused",
  "current_availability": "unknown",
  "expected_opening_window": "unknown",
  "compatible_days": "unknown",
  "age_band_fit": "unknown",
  "waitlist_status": "unknown",
  "tour_or_callback_available": "unknown",
  "evidence": "We don't give out availability information over the phone, please email us instead.",
  "requires_human_follow_up": true
}
```

## Cancellation before dial

If the operator withholds the exact authorization phrase after reviewing
the dry-run preview, the call must not be placed and no result other than
the dry-run preview is produced.
