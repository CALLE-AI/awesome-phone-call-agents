---
name: emergency-dispatch-cascade
description: Fills one urgent home-service job (burst pipe, no heat, electrical fault) by calling on-call technicians one at a time in priority order over CALL-E, stopping at the first acceptance, then places one confirmation call to the customer with the assigned technician and ETA.
license: MIT
---

# Emergency Dispatch Cascade

Use this skill when a home-service business (plumbing, HVAC, electrical) has **one**
urgent job and a roster of on-call technicians, and only one of them should end up
booked on it. It is a cascade, not a broadcast: technicians are rung one at a time,
in the order the business gives, and the moment one accepts, the rest are never
called. The skill then closes the loop by calling the customer back with the
technician's name and ETA — turning a job that would otherwise wait for a human
dispatcher into a booked, billable appointment within minutes.

This skill does not add a CALL-E backend queue, a provider-side campaign, a daemon,
or new MCP tools. It sequences the existing one-off CALL-E call workflow twice: once
per technician cascade, once for the customer confirmation.

## When To Use

Use this skill for:

- an incoming non-life-threatening home-service emergency (burst pipe, no heat,
  power outage in one unit, water heater failure) that needs a technician dispatched
  now, not scheduled for next week
- a roster of on-call technicians where calling all of them at once would risk
  double-booking the job
- closing the loop with the customer once a technician has accepted, so they are not
  left waiting to hear whether anyone is coming

## When Not To Use

Do not use this skill to:

- handle a life-threatening emergency — gas leaks, fire, carbon monoxide, electrical
  arcing, flooding that endangers people, or any medical emergency. Those callers
  must be told to contact 911 or local emergency services; this skill must refuse to
  run and say so instead of dispatching a technician
- negotiate price, warranty terms, or liability on the call; the goal states the job
  and asks for availability and ETA only
- broadcast the same job to every technician at once — that is a campaign, not a
  cascade, and this skill refuses to run calls in parallel
- decide on the agent's own authority what an unclear technician answer meant
- call a technician who is not on the roster the business supplied, or a customer
  number the business has not confirmed is correct for this job
- guess phone numbers, country codes, timezones, languages, or regions
- retry a technician who has already declined
- keep dialling technicians after the business's cutoff for same-day dispatch

## Required Inputs

Ask for any of these that is missing. Do not infer one from locale, phone number, or
earlier unrelated context.

| Field | Notes |
|---|---|
| job description | spoken to technicians and the customer, so it must be a real, specific description (e.g. "water heater leaking in the garage") |
| urgency / safety check | confirm the business has screened out life-threatening emergencies before this skill is invoked |
| customer name and phone (E.164) | used only for the final confirmation call |
| customer address | spoken to technicians so they can judge distance/ETA |
| technician roster | ordered list of `{name, phone (E.164)}`; the order is the business's dispatch priority, not the skill's to decide |
| consent | confirm the roster is an on-call staff list and the customer expects a callback about this job |

Optional: a same-day dispatch cutoff time, quiet hours for technicians, whether a
second sweep of no-answers should run once before giving up.

## Core Workflow

1. Confirm the emergency is not life-threatening. If it is, stop and tell the user to
   contact 911 or local emergency services instead of running this skill.
2. Confirm the business wants **one** technician assigned to **one** job, and that the
   roster and customer number are both consented contacts for this purpose.
3. Collect the required inputs above. Ask for anything missing; do not infer it.
4. Read [`references/safety.md`](references/safety.md) — it is the source of truth for
   ordering, retries, the stop condition, and the emergency-content boundary. Do not
   re-derive these rules.
5. Check CALL-E auth status (`calle auth status`) before the first call, so a token
   problem surfaces before anyone is rung.
6. Run the technician cascade (see Runtime Workflow). Report each outcome as it
   lands — the business may want to intervene mid-cascade.
7. On acceptance, place the single customer confirmation call. On exhaustion, tell the
   business the list is exhausted and a human must decide; do not call the customer
   with no technician assigned. In live mode, an accepted call is advisory only —
   the customer is never called until a human operator confirms the assignment (see
   Runtime Workflow).

## Runtime Workflow

### Phase 1 — Technician cascade

Repeat until the cascade ends:

1. **Pick the next technician** in roster order. Never call two at once.
2. **Check before dialling.** Skip anyone opted out, marked unavailable, or without a
   number, and say which — a silent skip is indistinguishable from a bug.
3. **Plan exactly one call** with `calle call plan` (see
   [`references/examples.md`](references/examples.md)) whose goal states the job,
   address, and asks for a yes/no plus an ETA. Inspect the plan before running it.
4. **Run it** with `calle call start`, then read the result back with
   `calle call status --run-id <run_id>` until a terminal status.
5. **Read the answer conservatively.** Anything that is not a clear yes is not a yes.
   An unreadable or ambiguous answer halts the cascade for a human to resolve — it is
   never scored as a decline, because a decline advances the list, and advancing past
   someone who was actually agreeing means nobody comes.
6. **On decline or no answer:** advance to the next technician.
7. **On acceptance:** stop dialling. In dry-run mode the technician is recorded as
   assigned immediately. In live mode, a "yes" heard on the call is **advisory
   only** — see the confirmation gate below before treating anyone as booked.

End conditions: a technician accepted; the roster is exhausted; the dispatch cutoff
passed; or the business stopped it. A call held for a human to resolve an unreadable
answer is **not** an end condition — the cascade is paused and resumes where it
stopped.

### Live-mode confirmation gate

A heuristically-detected "yes" and a call transport that finished `COMPLETED` are
signals, not a booking — a completed call only means the call finished normally, and
a positive-sounding transcript can misfire. So in live mode, the reference script
never proceeds to Phase 2 on its own: it prints the advisory acceptance and blocks on
an operator prompt. Only a human typing `CONFIRM`, and then supplying the ETA
themselves, turns an advisory acceptance into a real assignment. If the operator does
not confirm, the run stops with nobody booked and no customer call placed. This gate
does not run in dry-run mode, since nothing there is a real call.

### Phase 2 — Customer confirmation

Runs only after Phase 1 ends in acceptance.

1. **Plan exactly one call** to the customer whose goal states the assigned
   technician's first name and the ETA, and asks the customer to confirm they will be
   home.
2. **Run it** with `calle call start`, then read the result back the same way as
   Phase 1.
3. **Report the booking** to the business: technician, ETA, and whether the customer
   confirmed. This is the billable outcome of the skill.

## Safety

See [`references/safety.md`](references/safety.md) for the full rules, including the
emergency/medical/legal/financial content boundary, phone number handling, and
cancellation behavior. In short:

- **One call in flight, ever.** A second concurrent call is an error, not a slow path.
- **Life-threatening emergencies are out of scope.** The skill must refuse and point
  to 911 or local emergency services rather than dispatch a technician.
- **An unreadable technician answer halts the cascade** until a human says what it
  meant; it is never scored as a decline.
- **Numbers come from the business and the customer, never guessed.** Examples and
  fixtures use only standards-reserved fictional numbers.
- **Nothing recorded from a real call is published** — no transcript, recording, or
  provider identifier belongs in documentation or a demo, even redacted.
- **Cancellation is immediate**: because only one call is ever in flight, stopping the
  cascade stops everything except the call already ringing.

## Reference Implementation

A dry-run demo script that replays the two-phase cascade against fixture data — with
no live CALL-E calls and no account required — is at
[`scripts/dispatch-cascade.mjs`](scripts/dispatch-cascade.mjs). Pass `--live
--confirm-live` to route the same logic through the real `calle` CLI once CALL-E auth
is configured; both flags are required together, as the documented explicit-intent
check before anything real is dialed. The script also validates every technician and
customer number is a distinct, valid E.164 destination, refuses to dial the dry-run
fixture range for real, masks phone numbers in subprocess errors, and withholds raw
live transcripts from its own log output. See
[`references/examples.md`](references/examples.md) for sample fixtures and commands,
and [`references/safety.md`](references/safety.md) for the full rules.
