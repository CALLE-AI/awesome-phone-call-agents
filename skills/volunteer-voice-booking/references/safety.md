# Volunteer Voice Booking Safety
Volunteer booking calls affect real people and a real volunteer program. Keep the workflow narrow,
disclosed, and reversible.

## Disclosure
The call must start with:
- the caller is an AI phone assistant
- the call is on behalf of the named organization
- the call is a callback the volunteer requested through the booking form
- the volunteer can decline, ask for email follow-up, or stop the call
- when recording or transcription is enabled by the configured provider workflow, the call may be
  recorded or transcribed into a booking note for human review

Do not imply the volunteer is speaking with a human staff member directly.

## Allowed Questions
Allowed:
- confirm the volunteer's full name
- the approved qualification questions
- which pre-computed free slot works best
- timezone confirmation
- consent to receive a calendar invite and confirmation email

Not allowed:
- payment, donation, or billing details
- medical, legal, financial, or emergency content
- protected-class, immigration, disability, health, family, age, religion, or race topics
- pressure to accept a time
- claims that a slot is confirmed before a human approves it

## Phone Numbers
Use only E.164 numbers provided by the volunteer on their own form submission. Mask phone numbers in
logs and summaries. Use fictional reserved phone numbers in samples.

## Availability
Only offer `free_slots` that were computed from live availability and already overlap-checked against
existing bookings. Never let the model invent or extend availability.

## Evidence
Every selected slot and consent claim must be backed by a transcript span. If a response is unclear,
set `needs_human_review` to true and do not infer consent or a preferred time.

Store the minimum useful record: the structured booking result, evidence spans needed for review, and
the call identifier. Do not copy full transcripts into broad logs or summaries by default.

## Human Review
This skill never writes the calendar on its own. A human reviewer must approve the result before the
slot is booked and the meeting link and confirmation email are sent.

## Retries
No automatic repeated calls. If the result is no-answer, voicemail, ambiguous, or wrong number, the
coordinator decides the next step.
