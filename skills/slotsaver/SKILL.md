---
name: slotsaver
description: Runs an evening round of confirm-then-backfill phone calls for a clinic's tomorrow appointments — confirms each patient, retries a no-answer once, frees the slot on cancellation or reschedule, then calls the waitlist in order until every freed slot is refilled.
---

# SlotSaver — evening confirmation & waitlist-backfill skill

## Purpose

Clinics lose booked slots to no-shows and late cancellations because nobody
calls the waitlist at night. This skill places one evening round of phone
calls that (1) confirms every patient booked for tomorrow and (2) the moment
a slot frees up, calls waitlisted patients in order until someone takes it.

## When to use this skill

Use this skill when an operator wants a scheduled or on-demand phone-call
run that confirms a fixed list of appointments for a specific day and
backfills any that cancel, without a human dialing anyone.

## Setup phase (once per clinic)

Mandatory fields — do not infer any of these from unrelated context:

- Clinic name, doctor/agent persona name (who the caller says they are)
- Tomorrow's appointment list: patient name, phone in E.164, time slot
- An ordered waitlist: patient name, phone in E.164, used strictly in order
- CALL-E region and locale for the recipients
- An explicit allow-list of phone numbers real calls may be placed to —
  with no allow-list entry, no real call can be placed at all

## Runtime phase (one evening run)

1. Confirm-call every appointment on tomorrow's list, in order:
   - `confirmed` → mark CONFIRMED, move on
   - `no_answer` → retry once with a fresh idempotency key; a second
     `no_answer` is terminal — flag NEEDS-ATTENTION, do not call again
   - `reschedule` → free the slot only (does **not** trigger backfill)
   - `cancelled` → free the slot **and** trigger backfill for that slot
   - `wrong_person_or_unclear`, or a missing/malformed result (no
     `outcome` field, an out-of-schema value, or the call never reaches
     `completed`) → **stop on that appointment.** Do not treat it as
     `no_answer` (no automatic retry) and do not treat it as `cancelled`
     (no slot freed, no backfill call placed). Flag NEEDS-ATTENTION and
     require a human to reconcile the real outcome before any
     appointment/waitlist state changes on the strength of that call.
2. For each slot freed by a cancellation, call the waitlist in order
   (`accepted` / `declined` / `no_answer` / `wrong_person_or_unclear`)
   until someone accepts, then stop — never call the rest of the
   waitlist once a slot is filled. The same stop-and-flag rule applies
   here: a wrong-person or malformed offer-call result never advances
   to the next waitlist entry on its own.
3. Emit a run report: confirmed count, cancelled count, backfilled count,
   still-needs-attention count (no-answer and wrong-person/malformed
   cases both count here, and should be distinguishable in the report).

See `references/runtime-prompt.md` for the exact `task` prompt templates
and the full "Handling results that aren't a clean match" rule, and
`references/examples.md` for full request/response payloads, including
wrong-person and malformed-result examples.

## Scope and limits

- Appointment scheduling only — confirm, reschedule, cancel, backfill.
  This skill must never be used to give medical advice, triage
  symptoms, or handle an emergency; if a call surfaces anything outside
  rescheduling an appointment, the agent ends the call and the run
  flags it for a human, it does not attempt to help.
- Once a call has been submitted to CALL-E, this skill has no reliable
  way to cancel it in flight — the reference implementation doesn't
  expose (or depend on) an in-flight cancel. Treat a submitted call as
  something you can wait out, bounded by the client timeout
  (`CALLE_TIMEOUT_SECONDS`), not something you can reliably abort.
- See `references/safety.md` for the rest of the operating limits.

## Idempotency

Each call attempt uses a unique idempotency key per (patient, attempt
number, run date). A reused key returns CALL-E's cached result instead
of placing a second call — treat this as long-lived, but do not assume
a specific retention window or expiry. A legitimate retry must always
mint a new key regardless; reusing the original key silently drops the
retry.

## Safety guardrails

See `references/safety.md` for the full list. Summary:

- Real calls are only placed to numbers on an explicit allow-list.
- No phone number, API key, or auth token is ever exposed to a client-facing
  surface (masked numbers + opaque IDs only on any UI).
- A scheduled/automatic variant of this run must default OFF and require an
  explicit, revocable operator action to arm — it spends money and rings
  real phones unattended.
- Every call task explicitly forbids pressing phone/DTMF keys, learned after
  an early prompt taught the agent to press keys on itself mid-call.
- Wrong-person, ambiguous, and missing/malformed call results stop the
  run for that appointment/waitlist entry and require human
  reconciliation — they are never auto-retried as `no_answer` or
  auto-advanced as `cancelled`/`declined`.

## Reference implementation

Extracted from SlotSaver, a full reference implementation (Python CLI +
Cloudflare Worker orchestrator + live browser board) built for the CALL-E
hackathon: https://github.com/sujeet121696/slotsaver — see that repo's
README for deployment steps and the complete state-machine source.
