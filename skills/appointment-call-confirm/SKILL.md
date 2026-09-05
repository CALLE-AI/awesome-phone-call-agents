---
name: appointment-call-confirm
description: Places outbound CALL-E confirmation calls for a batch of upcoming appointments or bookings and returns a structured confirmed / needs-reschedule / declined / no-answer result per recipient, so a business can close its next-day no-show gap without a staff member manually dialing down the list.
license: MIT
---

# Appointment Call Confirm

## Why this exists

Any service business that books time slots — clinics, salons, repair
shops, tutoring, veterinary practices, small logistics/delivery
windows — loses revenue to no-shows. The standard mitigation is a
person on staff spending part of every afternoon manually phoning
tomorrow's appointment list to confirm, reschedule, or free up a slot.
It is repetitive, easy to skip on a busy day, and does not scale past a
handful of bookings.

`appointment-call-confirm` automates exactly that one workflow — not a
general-purpose "AI that makes phone calls." Given a list of upcoming
appointments (recipient, phone, appointment time, business/task
context), it places one outbound CALL-E call per appointment, asks the
recipient to confirm, reschedule, or cancel, and returns a structured
result per call that a host can write back to wherever appointments
already live (a spreadsheet, a calendar, a CRM, a CSV).

This is a **workflow skill**, not a new CALL-E backend API. It does not
add call-scheduling, recurrence, or provider-side state — it wraps
CALL-E's existing one-off `POST /v1/calls` / `GET /v1/calls/{id}`
Developer API in a batch-confirmation shape and hands the caller a
consistent result contract.

## When To Use

Use this skill when:

- a user has a list of upcoming appointments/bookings and wants each
  recipient called to confirm, reschedule, or cancel before the slot
- a user asks something like *"call everyone on tomorrow's schedule and
  confirm they're still coming"* or *"phone these 12 customers and ask
  if 2pm still works"*
- the result of each call needs to be written back somewhere
  structured (a sheet, a file, a downstream system) rather than just
  read aloud in chat

## When Not To Use

Do not use this skill to:

- place a single one-off call with no confirm/reschedule/decline
  structure — use CALL-E's plain call API directly instead
- create a recurring/scheduled calling job — see the `call-reminder`
  skill in this repository for scheduler-wrapped recurring calls
- call any recipient who has not already been given a specific
  appointment/booking with the caller's business — this skill is for
  confirming existing appointments, not cold outreach or lead
  generation
- guess a recipient's phone number, region, or language from anything
  other than what the caller/host explicitly provided
- place a call before the user has explicitly confirmed the appointment
  list is correct and that the calls should go out

## Core Workflow

1. **Collect the appointment batch.** Each entry needs, at minimum:
   `recipient_name`, `phone` (E.164), `appointment_time` (ISO 8601,
   with timezone), and a short `context` string (what the appointment
   is for — e.g. "annual checkup with Dr. Rao", "car pickup for
   invoice #4021"). Ask for any missing required field rather than
   inferring it.
2. **Dry-run the batch before calling anyone.** Print the full list
   (name, masked phone, time, context) and require explicit
   confirmation before any call is placed — see
   `references/safety.md`. This mirrors CALL-E's own guidance that
   phone-call workflows must be safe to preview without a real call.
3. **Build the CALL-E task per recipient** using
   `references/result-schema.md`'s `result_schema`, so CALL-E returns
   a structured `status` (`confirmed` / `needs_reschedule` /
   `declined` / `no_answer` / `voicemail`) and an optional
   `requested_new_time` instead of free text that has to be
   re-parsed.
4. **Place calls serially, not in parallel.** One call in flight per
   recipient at a time (see `scripts/place_confirmation_calls.py`).
   This keeps behavior predictable, keeps a single failing call from
   masking others, and avoids surprising a business with a burst of
   simultaneous outbound calls.
5. **Poll each call to a terminal state** using CALL-E's
   `GET /v1/calls/{call_id}` before moving to the next recipient (or
   asynchronously, if the host has its own webhook/queue — see the
   script's `--webhook-url` option).
6. **Write back one structured row per recipient**: name, masked
   phone, appointment time, call status, structured result, and the
   CALL-E `call_id` for auditability — to CSV by default
   (`scripts/place_confirmation_calls.py --out results.csv`), or
   forward each result to a host-provided sink (webhook, sheet,
   ticketing system).
7. **Never claim a call happened if CALL-E rejected the request.**
   Report the rejection reason from the API and move to the next
   recipient rather than retrying silently.

## Required Fields (per appointment)

- `recipient_name`
- `phone` — E.164, e.g. `+14155550101`
- `appointment_time` — ISO 8601 with timezone, e.g.
  `2026-09-05T15:00:00-04:00`
- `context` — one sentence describing what the appointment is for,
  used to build the call's `task`

Optional: `region` (CALL-E region code, defaults to inferring from the
phone country code if omitted — see `references/result-schema.md`),
`locale`, `business_name` (used in the call script), `metadata`
(free-form, echoed back with the result).

## Setup

```bash
pip install -r requirements.txt
export CALLE_API_KEY=calle_live_xxxxxxxx     # required
export CALLE_BASE_URL=https://api.heycall-e.com  # optional, this is the default
```

See `references/examples.md` for full dry-run and real-run walkthroughs.

Beyond `--in`, `--out`, `--dry-run`, and `--confirm`, this script also
enforces several safety properties directly in code (see
`references/safety.md` for the full contract):

- `--allowlist assets/authorized_numbers.example.txt` — restrict
  calling to only the phones listed in that file. Exact match only;
  anything not listed is skipped and reported as `failed: not
  authorized`, never dialed.
- Even with `--confirm`, a real run always requires the operator to
  interactively type `CONFIRM` before any call goes out. Pass `--yes`
  to skip that prompt for non-interactive/automation use (logged
  loudly when used — not a quiet default).
- `--allow-custom-host` — required if `CALLE_BASE_URL` is set to
  anything other than the official CALL-E host; otherwise the script
  refuses to run rather than risk sending the API key elsewhere.
- `--continue-on-ambiguous` — by default the batch halts the moment
  any call's outcome is `pending` or `unclear`, rather than dialing
  the rest of the list while something is unresolved. Pass this flag
  to disable that stop.

## Safety Rules

Read `references/safety.md` for the full contract. In short:

- This skill places real phone calls with real consequences — never
  run the batch without the user explicitly reviewing and approving
  the dry-run list first.
- Only call the phone numbers explicitly provided for this batch —
  never a number pulled from an unrelated contact list or guessed.
- Mask phone numbers in every user-facing summary (`+1415•••••01`);
  the full number is only ever sent to CALL-E's API, never printed to
  a log a bystander could read over someone's shoulder.
- Do not fabricate a `confirmed` / `declined` / etc. result if CALL-E's
  response doesn't clearly support it — report `unclear` and surface
  the raw summary instead of guessing.
- Do not retry a failed call automatically more than once per
  recipient per run; repeated unwanted calls are a real-world harm,
  not just a technical annoyance.
- Never expose the CALL-E API key in output, logs, or the results
  file.
- Treat any appointment context that reads as medical, legal, or
  financial as logistics-only — the call confirms a time, it does not
  discuss the underlying medical/legal/financial matter.

## Output Format

After a batch run, report per recipient:

- masked phone, appointment time, and CALL-E `call_id`
- final status: `confirmed` / `needs_reschedule` (with the requested
  new time, if any) / `declined` / `no_answer` / `voicemail` /
  `unclear` / `failed` (with the rejection reason)

And a one-line batch summary: `N confirmed, N to reschedule, N
declined, N no answer, N failed` — so a business can act on the
exceptions first instead of re-reading every row.

Never state a call was completed unless CALL-E's own status for that
`call_id` reached a terminal state.

## Files

- `scripts/place_confirmation_calls.py` — standalone runner: reads a
  CSV/JSON batch, dry-runs it, places each call through CALL-E's
  Developer API with the shared `result_schema`, polls to completion,
  and writes a results CSV. No dependency on any specific agent
  framework — just `requests` and the CALL-E API key.
- `scripts/test_place_confirmation_calls.py` — unit tests for the
  region-inference and result-parsing helpers in the runner above.
- `references/result-schema.md` — the exact `result_schema` sent to
  CALL-E and how each field maps to the output above.
- `references/safety.md` — the full safety contract this skill
  follows, aligned with this repository's repo-wide safety patterns.
- `references/examples.md` — worked dry-run and real-run examples,
  including sample CLI output and the resulting `results.csv`.
- `assets/sample_appointments.csv` — a ready-to-use example batch file
  in the input format this skill expects.
- `assets/authorized_numbers.example.txt` — example template for a
  manual, host-maintained record of recipients with a verified
  existing appointment (see `references/safety.md`).
- `requirements.txt` — the single runtime dependency (`requests`).
