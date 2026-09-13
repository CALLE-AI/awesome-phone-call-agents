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
2. For each slot freed by a cancellation, call the waitlist in order
   (`accepted` / `declined` / `no_answer`) until someone accepts, then stop —
   never call the rest of the waitlist once a slot is filled.
3. Emit a run report: confirmed count, cancelled count, backfilled count,
   still-needs-attention count.

See `references/runtime-prompt.md` for the exact `task` prompt templates
and `references/examples.md` for full request/response payloads using
each `result_schema`.

## Idempotency

Each call attempt uses a unique idempotency key per (patient, attempt
number, run date). CALL-E dedupes a reused key server-side forever, so a
legitimate retry must mint a new key — reusing the original key silently
drops the retry.

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

## Reference implementation

Extracted from SlotSaver, a full reference implementation (Python CLI +
Cloudflare Worker orchestrator + live browser board) built for the CALL-E
hackathon: https://github.com/sujeet121696/slotsaver — see that repo's
README for deployment steps and the complete state-machine source.
