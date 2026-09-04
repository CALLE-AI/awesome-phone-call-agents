---
name: appointment-confirm
description: Confirm one existing appointment by phone with CALL-E, capture yes/no and time as structured JSON, and leave calendar changes to a human. Dry-run and fixture modes by default.
license: MIT
---

# Appointment Confirm

Use this skill when a studio, clinic, or coordinator has explicit authority to place **one** disclosed phone call to confirm an existing booking. The call asks whether the recipient can attend the booked slot, captures a yes/no plus a confirmed or requested time, and returns fail-closed structured JSON.

This skill does not book, move, or cancel calendar events. A human reviews the result before any diary change.

## When To Use

- Confirm a booked appointment the recipient already knows about
- Capture a decline or a requested move to a pre-approved window
- Leave a short voicemail that asks them to call the business back
- Produce an evidence-backed disposition for a coordinator

## When Not To Use

- First-contact sales, lead qualification, or unsolicited marketing
- Medical, legal, financial, emergency, collections, or political calls
- Calling a number the user did not provide and authorize
- Hidden retries, recurring reminders, or automatic calendar writes
- Collecting payment, ID numbers, or health details

## Required Inputs

- `request_id`: stable local identifier
- `business_display_name`: name disclosed on the call
- `recipient_first_name`
- `to_phone_e164`: E.164, authorized
- `appointment.service`, `appointment.starts_at` (ISO-8601 with offset), `appointment.location`
- `timezone`: IANA
- `consent`: must be true
- `authorized_reason`: why this specific call is allowed

Optional: `reschedule_windows` (max 6 ISO-8601 times the coordinator can actually honor).

## Preflight

1. Confirm the user authorized this one confirmation call.
2. Confirm the phone is E.164 and came from the booking workflow.
3. Refuse if `do_not_call` is true or `consent` is not true.
4. Run a local preview before any CALL-E plan.

## Dry-Run Preview

From the repository root (no CALL-E credentials, no network):

```bash
python3 apps/python/appointment-confirm/client.py --request skills/appointment-confirm/assets/sample-appointment.json
python3 apps/python/appointment-confirm/client.py --request skills/appointment-confirm/assets/sample-appointment.json --mock
```

From the app directory:

```bash
cd apps/python/appointment-confirm
python3 client.py --request fixtures/sample_appointment.json
```

Preview prints a masked phone, the CALL-E task, and the result schema. It does not dial.

## CALL-E Goal Template

```text
You are an AI phone assistant calling on behalf of {business_display_name}.
Disclose immediately that you are AI and that this is one appointment-confirmation call.

Speak with {recipient_first_name}. If you have the wrong person, apologise and end the call.

Purpose: confirm the existing {service} on {starts_at_friendly} at {location}.
Do not sell, collect payment, or give medical, legal, or financial advice.

Ask whether they can attend. Capture can_attend as yes, no, or unknown.
If yes, read the time back and capture confirmed_time.
If no, offer only these windows: {reschedule_windows}. Capture requested_time.
Do not infer yes from silence. Do not update any calendar.
```

## Structured Result

```json
{
  "can_attend": "yes | no | unknown",
  "confirmed_time": "ISO-8601 or empty",
  "requested_time": "ISO-8601 or empty",
  "disposition": "confirmed | declined | reschedule_requested | voicemail | no_answer | wrong_number | needs_human"
}
```

A `confirmed` result is not a calendar write. `reschedule_requested`, voicemail, and unknown all need a human.

## Live Planning

Only after explicit user authorization and CALL-E authentication:

```bash
export CALLE_API_KEY="<server key>"
python3 apps/python/appointment-confirm/client.py --request <authorized-intake.json> --execute --confirm-consent
```

Planning via the CALL-E CLI is also valid and is not execution:

```bash
calle call plan --to-phone <E164_PHONE> --goal "<reviewed goal text>" --timezone Europe/London --language English --region GB
```

Do not run `calle call start` or this app's `--execute` unless the user separately confirms.

## Cancellation And Idempotency

Idempotency key: `appointment_confirm:{request_id}:{starts_at}`. If the user cancels before dial, do not execute. If a result is ambiguous, route to a human rather than calling again.

## Safety Notes

Read `references/safety.md` and `references/examples.md` before live planning.
