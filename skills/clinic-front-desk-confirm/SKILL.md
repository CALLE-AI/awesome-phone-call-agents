---
name: clinic-front-desk-confirm
description: Confirm one existing clinic or practice appointment by phone with CALL-E. Practice/dry-run by default. Captures kept, cancelled, reschedule, or no-answer without writing to any calendar.
license: MIT
---

# Clinic Front Desk Confirm

Use this skill when a clinic or practice front desk has explicit authority to place **one** disclosed phone call to confirm an existing booking. The call asks whether the patient can keep the slot, captures kept / cancelled / move request / no answer, and returns structured JSON for a human to apply.

This skill does not book, move, or cancel calendar events. A human reviews the result before any diary change.

Runnable product demo: [MNLABSUK/appointment-confirm](https://github.com/MNLABSUK/appointment-confirm) (FastAPI call desk, practice mode default).

## When To Use

- Confirm a booked hygiene, GP, physio, or vet slot the recipient already knows about
- Capture a cancel or a requested move to a window the desk can honour
- Produce an evidence-backed disposition for reception staff
- Demo CALL-E appointment confirmation with a no-network practice path

## When Not To Use

- First-contact sales, lead qualification, or unsolicited marketing
- Medical advice, diagnostics, emergency, collections, or political calls
- Calling a number the operator did not provide and authorize
- Hidden retries, recurring reminders, or automatic calendar writes
- Collecting payment, ID numbers, or health details beyond appointment logistics

## Required Inputs

- `who`: patient / guest display name
- `when`: human-readable or ISO appointment time
- `where`: clinic / practice display name (disclosed on the call)
- `purpose`: reason for visit (for example hygiene, follow-up)
- `phone`: E.164 destination the operator owns or has consent to call
- `mode`: `dry-run` (default) or `live`
- Optional `scenario` for practice mode: `confirmed` | `declined` | `reschedule_requested` | `no_answer`

## Preflight

1. Confirm the operator authorized this one confirmation call.
2. Confirm the phone is E.164 and came from the booking workflow.
3. Default to practice / dry-run. Refuse live mode without `CALLE_API_KEY` and explicit operator intent.
4. Preview the opening script before any live CALL-E plan.

## Practice Path (no network)

From the companion repo:

```bash
cd appointment-confirm
python -m appointment_confirm demo
python -m appointment_confirm serve --host 127.0.0.1 --port 43148
```

Or from this repository's app pointer:

```bash
cd apps/python/clinic-front-desk-confirm
python3 client.py --practice
```

Practice mode never dials. Phones are masked in results (`***0123`).

## Opening Script Shape

```text
Hi, this is the front desk at {where} calling for {who}.
Just checking you're still okay for your {purpose} on {when}.
You can say yes to keep it, no to cancel, or ask us to find another time.
```

Disclose that the call is for appointment confirmation only. Do not give clinical advice.

## Structured Result

Return:

- `outcome`: `confirmed` | `declined` | `reschedule_requested` | `no_answer`
- `phone`: masked
- `idempotency`: unique key for the attempt
- `summary`: one-line human summary
- `transcript`: short call notes
- optional `reschedule_window` when the patient asks to move

## Side Effects

- Practice mode: no phone call, no provider spend
- Live mode: places exactly one CALL-E call to the authorized number
- Never writes calendars, CRMs, or payment systems

## Cancellation

- Live attempts are one-shot; do not auto-retry
- Operator can discard a practice result without side effects
- If the wrong person answers, apologise and end the call

## Safety

See `references/safety.md`.
