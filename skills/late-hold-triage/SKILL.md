---
name: late-hold-triage
description: Places one outbound CALL-E call to a guest who is already late for a held table or appointment, captures a structured still-coming plus ETA result, and decides KEEP_HOLD, RELEASE_NOW, or NEEDS_HUMAN against the remaining hold window without calling the waitlist.
license: MIT
---

# Late Hold Triage

Use this skill when a booked guest is late **right now** and the floor needs a
yes, a no, or a human — not a guess — before the held slot is given away.

`late-hold-triage` is a one-recipient decision skill. It does not add a CALL-E
backend queue, a campaign, or a waitlist dialer. It places at most one outbound
call to the late guest, reads a structured result, and compares the spoken ETA
to the hold that is still on the clock.

This is the missing half of next-day confirmation and first-accept cascades:

- `appointment-call-confirm` calls tomorrow's whole book in advance
- `standby` / `priority-call-waterfall` offer a **freed** slot down a list
- this skill calls the **late guest who still owns the slot** and only then
  recommends whether a human should start a cascade

It never dials the waitlist. A `RELEASE_NOW` is a recommendation to the host,
not permission to ring the next person.

## When To Use

Use this skill when:

- a restaurant, salon, clinic front desk, or repair shop is holding a slot for
  a guest who has passed the booked start time
- staff need a spoken ETA, not a text that may never arrive
- the hold has a hard end (`hold_until`) and giving the slot away too early
  or too late both cost money
- the operator asks something like *"they're 12 minutes late — do we still
  hold table 7?"*

## When Not To Use

Do not use this skill to:

- confirm tomorrow's appointments — that is `appointment-call-confirm`
- fill a slot that is already free — that is `standby` or `priority-call-waterfall`
- call anyone other than the late guest on this run
- diagnose, treat, collect a debt, or discuss legal or medical substance
- infer a phone number, timezone, or hold end the operator did not supply
- treat silence, voicemail, or an unreadable answer as a release

## Required Inputs

Ask for any of these that is missing. Do not infer one from locale, the phone
number, or an earlier unrelated chat.

| Field | Notes |
|---|---|
| `guest_name` | Spoken on the call so the right person can confirm identity |
| `phone` | E.164, supplied by the operator |
| `slot_start` | ISO 8601 with timezone — when the booking began |
| `hold_until` | ISO 8601 with timezone — when the house stops holding |
| `business_name` | Who the call says it is calling for |
| `context` | One logistics sentence, e.g. "table for two at the window" |

Optional: `region`, `locale`, a dry-run fixture file, `--now` to replay a clock.

`hold_until` must be after `slot_start`. A hold that has already expired is
reported as `HOLD_EXPIRED` and no call is placed.

## Core Workflow

1. Collect the required fields. Refuse to invent a number or a hold end.
2. Dry-run first. Print the masked destination, remaining hold minutes, and
   the exact task text. Default mode places **zero** calls and needs no
   install — see `scripts/triage_late_hold.py`.
3. If the hold has already expired at `--now`, stop. Do not call a guest
   about a slot the house has already given away.
4. Live mode requires both `--confirm` (operator intent) and
   `--authorized-numbers` (this specific destination). See
   `references/safety.md`.
5. Place exactly one CALL-E call with the shared `result_schema` in
   `references/result-schema.md`. Poll it to a terminal state.
6. Decide with the deterministic rules in Runtime Workflow. Do not ask a
   second model to "interpret" the transcript.
7. Report one of `KEEP_HOLD`, `RELEASE_NOW`, `NEEDS_HUMAN`, or
   `HOLD_EXPIRED`, plus the masked phone and `call_id`. If the decision is
   `RELEASE_NOW`, tell the operator they may now start a separate cascade
   skill. This skill will not start it.

## Runtime Workflow

```text
if now >= hold_until:
    HOLD_EXPIRED          # no call
else if spoken status is no_answer, voicemail, unclear, or missing:
    NEEDS_HUMAN           # never auto-release on silence
else if still_coming is false OR released is true:
    RELEASE_NOW
else if still_coming is true AND eta_minutes is an integer:
    if eta_minutes <= minutes_until(hold_until):
        KEEP_HOLD
    else:
        RELEASE_NOW       # they cannot arrive inside the hold
else:
    NEEDS_HUMAN
```

`eta_minutes` must be a non-negative integer the guest actually spoke. A
vague "soon" or "on my way" without a number is `NEEDS_HUMAN`, not a keep.

An ambiguous CALL-E outcome (no call id, transport error, poll timeout)
halts the run. It is not scored as a release.

## Safety

Read `references/safety.md`. In short:

- Dry-run is the default. Live calls need `--confirm` and an authorized
  number that exactly matches the guest phone.
- One call, one destination, one attempt per run. No waitlist, no retry
  loop, no parallel legs.
- Phone numbers are masked in every printed or written summary.
- The API key is sent only to an allowlisted HTTPS CALL-E origin.
- Logistics only. The task text never asks about diagnosis, payment cards,
  or legal matters.
- CALL-E has no cancellation endpoint. Stopping the script prevents a call
  that has not been created; it cannot pull back a call already accepted.

## Output

One decision row:

- `decision`: `KEEP_HOLD` / `RELEASE_NOW` / `NEEDS_HUMAN` / `HOLD_EXPIRED`
- `guest_name`, masked phone, `slot_start`, `hold_until`
- `still_coming`, `eta_minutes`, `released` when the structured result has them
- `call_id` when a live call was created
- `next_step`: empty on keep; "start a cascade skill if you want the slot
  filled" on release; "a human must read this call" on needs-human

Never claim a call completed unless CALL-E reached a terminal status.

## Files

- `scripts/triage_late_hold.py` — stdlib dry-run runner; live path needs
  `requests` from `requirements.txt`
- `scripts/test_triage_late_hold.py` — decision, gate, and masking tests
- `assets/sample_holds.csv` — fictional reserved-number fixtures
- `assets/dry_run_outcomes.json` — spoken outcomes for the dry-run clock
- `assets/authorized_numbers.example.txt` — format only
- `references/result-schema.md` — CALL-E `result_schema` and task text
- `references/safety.md` — full safety contract
- `references/examples.md` — copy-paste dry-run and live commands
