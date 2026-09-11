---
name: urgent-help-escalation-call
description: When a vulnerable person asks for help inside an app, ring the human responsible for them and say only what is needed — who asked, and when. Returns whether the message actually landed and whether anyone confirmed they are going. Use for panic and help buttons, lone-worker duress alarms, fall and inactivity alerts, post-discharge escalation, care-home call bells, and any "the notification is not enough, phone someone" workflow.
license: MIT
---

# Urgent Help Escalation Call

Use this skill when software has learned that someone needs a human, and a
notification is not good enough.

An in-app alert is only as good as somebody looking at a screen. The moments
when that assumption fails are exactly the moments the alert exists for: the
middle of the night, a shower, a meeting, a commute. A ringing phone is the one
channel that reliably interrupts.

This skill is the bridge. One trigger, one call, one clear answer about whether
it landed.

## The two people

Getting this wrong is the failure mode that matters most, so name them
separately in your own code:

| | Who | Role |
| --- | --- | --- |
| **Subject** | the vulnerable person | asked for help; is **never** called by this skill |
| **Recipient** | the carer, responder, or next of kin | the one whose phone rings |

Dialling the subject instead of the recipient means telling a frightened person
that a frightened person needs help. Keep the two numbers in separate fields,
label them unambiguously in any UI, and validate them separately.

## When To Use

- panic buttons and help buttons in apps used by vulnerable people
- lone-worker duress alarms
- fall detection, inactivity timeouts, or bed-exit alerts
- care-home call bells that need to reach staff who are not at a station
- post-discharge deterioration flags
- any in-app urgent signal where "they will see the notification" is a bad bet

## When Not To Use

Do not use this skill to:

- replace emergency services — see [Emergencies](#emergencies)
- call the subject themselves, for any reason
- deliver clinical detail, triage, or advice by phone
- send routine or digest notifications; this is for urgent signals only
- escalate something the subject did not actually ask for, without saying so
- call a responder who has not agreed to be called

## Required Fields

Ask for anything missing. **Never** infer these:

| Field | Notes |
| --- | --- |
| `recipient_phone` | E.164. The responder's number, never the subject's. Validate; never guess a country code. |
| `subject_name` | What the responder should be told, e.g. "Eleanor". |
| `triggered_at` | When the request happened, so the call can say *when* rather than "just now". |
| `recipient_name` | Optional but strongly preferred — being addressed by name at 3am is worth a lot. |
| `region` | Optional. Chosen, not inferred — it decides which line the call comes from. |

## Core Workflow

1. Confirm the trigger is genuinely urgent and came from the subject or a
   sensor, not from a routine event.
2. Check the cooldown for this subject. If a call went out recently, stop —
   see [`references/repeat-triggers.md`](references/repeat-triggers.md).
3. Build the message from [`references/call-goal.md`](references/call-goal.md).
   Short. One fact, one instruction.
4. Place exactly one call to `recipient_phone`, with an idempotency key derived
   from the recipient and the trigger minute so a retried request cannot ring
   twice.
5. Read the structured result: did it reach the recipient, and did they confirm.
6. If it did not reach them, follow
   [`references/escalation-ladder.md`](references/escalation-ladder.md).
7. Record the outcome where the humans involved can see it.

**Fire the call without blocking the trigger.** The subject is standing there
having asked for help; the app's response to them must not wait on a phone
network, and a failure to connect must never surface to them as an error. Raise
your in-app alert first, place the call alongside it.

## What The Call Says

**Confirm who is listening before you disclose anything.** This ordering is the
design, not a nicety:

```
"Hello, this is <product>. Am I speaking with <recipient>?"
   ├─ no / unsure → "Sorry to have troubled you. Goodbye."  → hang up, say nothing
   └─ yes         → "<subject> has pressed the help button and is asking for
                     you. Please go to them when you can."
                  → "Are you able to get to them?" → thank them → hang up
```

The obvious design leads with the message to save a second. It is wrong. A
number will eventually be answered by a neighbour, a partner, a child, or a
stranger with a recycled number — and leading with the message tells them a
named vulnerable person has asked for help before you know who is listening.
Nothing downstream can un-say it, and a "if it's the wrong person, stop" branch
fires only after the model has already spoken.

After the gate:

- Do not sound alarmed. Panic on the phone gets nobody there faster.
- Do not speculate about *why*. You do not know, and a guess becomes what the
  responder believes on the drive over.
- Say nothing about the subject's health, condition, or history.
- Never ask a stranger to pass the message on — that is a disclosure with extra
  steps.
- Ask whether they can go — **a question, not an instruction**. "Confirm you are
  going to her" reads as an order barked at someone just woken up. Ask once,
  accept the answer, do not press. They may be two hours away.
- Sound like a person passing on a message, not a system issuing one. Models
  drift officious when handed numbered steps and a schema; say the register you
  want out loud.
- **Voicemail names nobody.** It is the one case where the gate cannot run, so
  the message must be safe for a whole room to overhear: no name, no reason,
  just "there is an alert waiting in your app".
- Keep it under a minute.

Full template and the reasoning line by line: [`references/call-goal.md`](references/call-goal.md).

## Structured Result

Two questions, no more:

```json
{
  "reached": "caregiver | someone_else | voicemail | no_answer",
  "acknowledged": "yes | no | unknown"
}
```

`reached` is not the same as `acknowledged`. A voicemail is a message left, not
a person on their way, and the difference decides whether the ladder continues.
Full schema and the reasoning: [`references/result-schema.md`](references/result-schema.md).

## Consent

Simpler than a call *to* a vulnerable person, but not nothing:

- **The recipient agreed to be called.** They configured the number, or someone
  authorized to did. Record who and when.
- **The subject knows this happens.** Pressing a help button should be
  understood as "this will fetch someone", and any consent flow should say so
  plainly rather than burying it.
- **Health information is disclosed to whoever answers.** That is why the
  message says only that someone asked for you. See
  [`references/consent-and-boundaries.md`](references/consent-and-boundaries.md).

## Repeat Triggers

Someone frightened, confused, or in pain may press a button many times in a
minute. The responder needs one call, not eleven — and each one costs money.

Hold a cooldown per subject, not per request. Suppress inside the window and log
that you did. Never let one subject's cooldown silence another's.
Details and the trade-offs: [`references/repeat-triggers.md`](references/repeat-triggers.md).

## Emergencies

**This is not an emergency service and must never be presented as one.**

It reaches one nominated person, who may be asleep, driving, or unreachable. It
cannot assess anything. It does not know whether the subject is hurt.

Say plainly in your product and your setup docs that the subject must have a
real route to emergency help that does not depend on this call being placed,
answered, or correctly understood.

## Side Effects, Cancellation, Cost

- **Side effect:** one real outbound phone call to a real person, per trigger
  that survives the cooldown.
- **Cancellation:** nothing to cancel once a call connects. This skill creates
  no provider-side recurrence — it fires on an event, not a schedule.
- **Cost:** one call from the CALL-E account per escalation. The cooldown is
  what stands between a distressed subject and a large bill.
- **No-call path:** this contribution ships a fake CALL-E server
  (`scripts/fake-calle-api.mjs`) serving the documented shapes, so the trigger,
  call contract, structured result, and escalation ladder can be exercised
  without ringing anyone. Use it for tests, CI, and demos.

## Reference design

This pattern was developed for **Yadira**, a companion for people living with
dementia. In that product, a person presses a help button; the ordinary in-app
alert is raised immediately, and CALL-E separately rings the configured
caregiver. The subject's number is never supplied to this workflow.

Two decisions from that implementation are worth copying:

**Do not make the phone call the only alert.** A call can be delayed, silenced,
or missed. Raise the in-app alert first and treat the phone call as an
additional interruptive channel.

**The provider's voice is not yours.** If your product depends on a specific,
familiar voice for the vulnerable person, an outbound provider voice may be the
wrong channel. This skill deliberately calls the responder instead.
