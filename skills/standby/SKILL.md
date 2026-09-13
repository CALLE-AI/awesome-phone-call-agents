---
name: standby
description: Fill one open shift by calling a standby roster strictly one person at a time and stopping at the first acceptance, for no-show cover, on-call escalation, and shift-swap requests where calling everyone at once would double-book the slot.
license: MIT
---

# Standby

Use this skill when the user has **one** slot to fill and **many** people who could take it, and only one of them may end up saying yes — a care home short a nurse at 05:40, a restaurant a commis before dinner service, a depot a loader before the trailer leaves.

`standby` is a cascade skill. It does not add a CALL-E backend queue, a provider-side campaign, a daemon, or new MCP tools. It sequences the existing one-off CALL-E call workflow: one call at a time, in an order the user supplies, stopping the moment someone accepts.

The distinction that matters: a broadcast campaign asks twenty people a question. A cascade asks one person a question, and asks the next one only because the first said no. Getting four acceptances for one shift is a worse outcome than getting none, because now a human has to un-invite three people.

## When To Use

Use this skill for:

- filling a single open shift, slot, or appointment from a list of candidates
- on-call escalation where the next person is rung only if the previous one does not answer
- any "ring round until someone says yes" task
- shift-swap requests, cover requests, and last-minute no-show replacement

## When Not To Use

Do not use this skill to:

- broadcast the same message to many people — that is a campaign, not a cascade, and this skill will refuse to run calls in parallel
- decide, on the agent's own authority, what an unclear answer meant
- fill several slots at once from one roster; run one cascade per slot, or the stop condition is ambiguous
- call anyone who is not on the roster the user supplied
- guess phone numbers, country codes, timezones, languages, or regions
- call a number the user has not confirmed the owner consented to receive calls on
- negotiate pay, hours, or terms on the call; the goal states the shift and asks yes or no
- retry a person who has already declined
- keep dialling after the shift has started

## Required Inputs

Ask for any of these that is missing. Do not infer one from locale, phone number, UTC offset, or earlier unrelated context.

| Field | Notes |
|---|---|
| shift start | local time **and** an IANA timezone |
| shift end | used only to state the length on the call |
| role and location | spoken to the callee, so it must be a real description |
| roster | ordered list of `{name, phone (E.164)}`; the order is the user's business rule, not the skill's |
| consent | the user must confirm the roster is a standby list whose members expect these calls |

Optional: quiet hours, a cutoff before the shift, whether no-answers get a second sweep.

## Core Workflow

1. Confirm the user wants **one** slot filled, and that the roster is a consented standby list.
2. Collect the required inputs above. Ask for anything missing; do not infer it.
3. Read `references/cascade-rules.md` — it is the source of truth for ordering, retries, callbacks, quiet hours and the stop condition. Do not re-derive these.
4. Check CALL-E auth status before the first call, so a token problem surfaces before anyone is rung.
5. Run the cascade (see Runtime Workflow). Report each outcome as it lands, not only at the end — the user is standing over this decision and may want to stop it.
6. When it ends, state the outcome in one line: who accepted and when they arrive, or that the list is exhausted and a human must decide.

## Runtime Workflow

Repeat until the cascade ends:

1. **Pick the next person.** Callbacks that are now due first, then untried people in roster order, then the second sweep of people who did not answer. Never two at once.
2. **Check before dialling.** Skip anyone opted out, marked unavailable, or without a number, and say which — a silent skip is indistinguishable from a bug.
3. **Check the clock.** Inside quiet hours, do not dial unless the shift is imminent (see `references/cascade-rules.md`). Past the cutoff, stop entirely.
4. **Plan exactly one call.** Inspect the plan before running it: it must target the intended number and contain the intended shift details.
5. **Run it,** then read the result back.
6. **Read the answer conservatively** using `references/reading-the-answer.md`. Anything that is not a clear yes is not a yes, and anything that is not clear at all is not a no either.
7. **On an answer you cannot read: stop and ask.** Do not record it as a decline and move on — that passes over someone who may have been agreeing, and rings the next person about a shift that may already be taken. Report what was unreadable and wait. Place no further call until the user says what it meant, and record who said it.
8. **On acceptance: stop.** Do not dial anyone else. Record the arrival time, and if it is after the shift starts, say so in minutes rather than reporting a clean fill.

End conditions: someone accepted; the list is exhausted; the shift started; or the user stopped it. A call held for the user to resolve is **not** an end condition — the cascade is paused and resumes where it stopped.

## Safety

- **One call in flight.** This is enforced, not advised. A second concurrent call is an error, not a slow path.
- **An unreadable answer halts the cascade** until a person says what it meant, and their name is recorded with the decision. It is never scored as a decline; a decline advances the list, and advancing on a call nobody could read is how a willing person gets passed over silently.
- **Numbers come from the user.** The skill never sources, guesses or completes a phone number. Numbers in examples and samples come only from ranges a regulator or network operator has permanently withheld from allocation — see `references/safety.md`.
- **Nothing recorded from a real call is published.** No transcript, recording, provider identifier or screenshot of one belongs in documentation or a demo, even with the number scrubbed.
- **Opt-outs are honoured before dialling**, and the reason is recorded.
- **Every attempt is logged** with its time, its outcome and its transcript, so a person can later ask why someone was or was not called and get an answer.
- **Cancellation is immediate**: because only one call is ever in flight, stopping the cascade stops everything except the call already ringing.

## Reference Implementation

A runnable dashboard implementing this skill, with a fixture mode that replays authored calls — written, not recorded — so the whole cascade can be watched with no CALL-E account, is linked from `references/reference-implementation.md`.
