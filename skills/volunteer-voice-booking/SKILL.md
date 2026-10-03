---
name: volunteer-voice-booking
description: Book a real appointment for a volunteer who requested a callback. Calls the volunteer, runs a short qualification interview, captures a preferred time slot, and writes the booking to a per-type calendar with a meeting link, behind a human approval gate.
license: MIT
---
# Volunteer Voice Booking
Use this skill when a nonprofit, community host, or volunteer coordinator wants to turn a callback
request into one scheduled appointment, reached over the phone rather than through a web form.

`volunteer-voice-booking` turns one callback request into at most one **call**, one **structured
result**, and at most one **calendar booking**. It is outbound-first: the volunteer leaves a number
on a "Book a call" form, and the agent calls back to run the interview and book the slot. It does not
answer an inbound hotline, run a call campaign, or manage recurring schedules. Recurrence belongs to
the host scheduler.

The workflow is deliberately narrow: confirm the volunteer, ask the qualification questions, offer
only pre-computed free slots, capture consent, and hand the booking to a human approval gate.

## When To Use
Use this skill for:
- calling back a volunteer who submitted a "Book a call" or callback request
- running a short qualification interview over the phone
- confirming a preferred 30-minute slot from a set of real, pre-computed free slots
- writing the result to a calendar as a real event with a meeting link and confirmation email
- keeping every booking behind a human "Approve & call" gate

## When Not To Use
Do not use this skill to:
- call people who did not request a callback or otherwise ask to be contacted
- answer an inbound hotline (that requires a dispatcher and result webhook, not a callback)
- collect payment, donations, or billing details
- deliver medical, legal, financial, or emergency instructions
- invent availability that the scheduler did not provide
- book a slot without a human sign-off, or re-call someone who declined

## Required Inputs
- `request_id`: stable local request identifier
- `volunteer_name`: name as provided on the form
- `to_phone_e164`: volunteer phone number in E.164 format
- `organization_name`: organization to disclose on the call
- `booking_purpose`: the calendar bucket, such as `onsite`, `online`, or `partnership`
- `slot_duration_minutes`: expected appointment duration (for example, 30)
- `free_slots`: list of pre-computed bookable windows, already checked against existing bookings
- `qualification_questions`: the short screening questions to ask
- `timezone`: IANA timezone used to present the slots

Optional inputs:
- `volunteer_email`
- `language`
- `region`
- `voicemail_allowed`
- `voicemail_message`

## Preflight
Before planning a call:
1. Confirm the volunteer explicitly requested this callback.
2. Confirm the phone number is E.164 and came from the volunteer's own form submission.
3. Confirm `free_slots` are real, computed from live availability, and overlap-checked.
4. Confirm the qualification questions are approved and limited to booking intent.
5. Prepare a dry-run preview before any live CALL-E action.

## CALL-E Goal Template
Use this as the CALL-E `--goal` body after filling the inputs:

```text
You are an AI phone assistant calling on behalf of {organization_name}. Disclose that immediately
and say this is the callback the volunteer requested through the booking form.

Purpose: help {volunteer_name} book a {slot_duration_minutes}-minute {booking_purpose} appointment.
Ask the qualification questions, confirm a preferred time, and capture a booking decision. Do not
collect payment, discuss pricing, or make medical, legal, or financial commitments.

If the configured CALL-E workflow records or transcribes calls, disclose that before asking
questions and say the transcript is used only to create the booking.

Qualification questions:
{qualification_questions}

Free slots (the only bookable times, in timezone {timezone}):
{free_slots}

Ask:
1. Confirm the volunteer's full name.
2. Walk through the qualification questions.
3. Which of the free slots works best?
4. Confirm the timezone to use.
5. Does the volunteer consent to receive a calendar invite and confirmation email for this slot?

If the volunteer declines, is uncertain, or asks a question outside booking, thank them and mark the
result for human review. Do not invent availability; only offer the provided free slots.

Return a structured result with disposition, volunteer_name, booking_purpose, selected_slot,
consent_to_book, evidence, and needs_human_review. Do not infer consent from silence.
```

## Structured Result
```json
{
  "disposition": "booked | declined | voicemail | no_answer | wrong_number | needs_human_review",
  "request_id": "string",
  "volunteer_name": "string",
  "booking_purpose": "onsite | online | partnership | other",
  "selected_slot": {
    "start": "string",
    "timezone": "string"
  },
  "consent_to_book": "boolean; true only when the volunteer explicitly consents",
  "followup_preference": "phone | email | none",
  "voicemail_left": false,
  "needs_human_review": true,
  "evidence": [
    {
      "claim": "string",
      "transcript_span": "string"
    }
  ],
  "do_not_rely_on": [
    "string"
  ],
  "notes": "string"
}
```

## Dry-Run Preview
Run a local, no-call preview before any live CALL-E action:

```bash
node scripts/preview-volunteer-booking.mjs assets/sample-volunteer-request.json
```

The preview prints a masked phone number, a redacted CALL-E planning command, the computed free
slots, and the structured result schema. It does not place a call and does not contact CALL-E.

## Live Planning
Only after explicit authorization and CALL-E authentication, copy the generated goal into a CALL-E
planning command:

```bash
calle call plan --to-phone <E164_PHONE> --goal "<reviewed goal text>" --timezone Asia/Bangkok --language English
```

Planning is not execution. Do not run `calle call start` or `calle call run` unless the user
separately confirms the provider's plan details and confirmation token.

## Human Gate
A completed call result is not yet a booking. A human reviewer must approve the result before the
slot is written to the calendar. In the reference implementation this is a host "Approve & call"
action; nothing is dispatched automatically.

## Cancellation And Idempotency
Derive an idempotency key from `request_id`, volunteer, purpose, and selected slot. If the volunteer
cancels, mark the request stopped and do not retry. If a call outcome is ambiguous, route to human
review rather than calling again automatically.

## Safety Notes
Read `references/safety.md` before using live planning, and review `references/examples.md` for safe
and unsafe examples.
