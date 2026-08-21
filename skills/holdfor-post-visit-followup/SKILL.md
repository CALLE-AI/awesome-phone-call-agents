---
name: holdfor-post-visit-followup
description: Place one bounded post-appointment check-in phone call to an older patient on behalf of a practice, return four enumerated answers plus a verbatim quote, and stop the call rather than answer anything clinical. Produces a Review Item for a named human; never books, never advises, and never asks the patient to confirm personal details.
license: MIT
---

# HoldFor post-visit follow-up

Use this skill to place the **Check-in Call**: one outbound call from a practice to a
patient a few days after an appointment, asking four bounded questions at her pace and
returning a structured result a named member of staff will read.

Terms in bold with a capital are defined in the repository's `CONTEXT.md` and are
load-bearing. Do not substitute "ticket" for **Review Item**, "approval" for
**Release**, or "escalation" for **Stop Condition**.

## What this skill does not do

It does not book anything. It does not decide anything. It carries no authority to
place the second call in the workflow — the **Rebooking Call** — and cannot cause one
to happen. Only a **Release**, granted by a named human who read the transcript, does
that. See
[ADR 0003](../../docs/adr/0003-a-release-grants-a-bounded-authority.md).

It has no write path to any clinical record, by design and not by omission. See
[ADR 0001](../../docs/adr/0001-no-agent-write-path-to-the-clinical-record.md).

## When to use

- An appointment happened, the practice operates this workflow, and the patient has
  recorded consent to be called.
- It is inside the **Reading Window** — the hours when a flagged result will actually
  be read by a human today. A call whose result nobody can read is not worth placing.
- The patient is an adult with an existing care relationship with the practice.

## When not to use

- No recorded consent. There is no fallback and no implied consent; the call is simply
  not placed.
- Outside the Reading Window, including weekends. This is a refusal, not an error.
- The patient can use the online portal comfortably. Then "use the portal" is a
  complete answer and this call has no reason to exist.
- Anything clinical is being asked of the agent. Read the **Safety Line** and stop.
- Cold outreach, marketing, screening a population, or any call to someone the
  practice has no existing relationship with.

## The call

Read [`references/call-task.md`](references/call-task.md) for the authored wording. It
is the source of truth for what the agent says, and the sentences marked fixed are
pinned by tests because each one carries a promise.

Four questions, three bounded and one open:

| # | Question | Field |
| --- | --- | --- |
| 1 | Since {weekday}, are you feeling better, about the same, or worse? | `feeling` |
| 2 | Are you getting on alright with what they gave you? | `medication_ok` |
| 3 | Is there anything worrying you? | **Carried Words** |
| 4 | Would you like the surgery to see you again? | `wants_seen` |

Question 2 is asked only when the appointment changed her medication. Otherwise it is
not put to her at all and the field records `not_asked`.

The result shape is [`result-schema.json`](result-schema.json).

## The Never-Ask Rule

The call asks for no date of birth, no address, no NHS number, and nothing resembling
payment — and it says so aloud.

This inverts the usual "verify the caller first" instinct deliberately. An unexpected
voice asking an older person to confirm personal details is the most recognisable
opening of a telephone scam there is, so a genuine call that opens that way cannot be
told apart from a fraudulent one. **The call that cannot ask is the only one that can
be trusted.** The agent proves itself instead with a fact only the practice holds: the
day she was seen.

Identifiers that reception needs are supplied later by the Rebooking Call, from the
practice's own record. They are never obtained from the patient.

## Carried Words are verbatim or nothing

The answer to question 3 is stored as a substring of a single patient turn, together
with that turn's index — or not stored at all. Never generated, never summarised,
never tidied into better English.

No span is a valid outcome. The Review Item then queues for a human instead of
carrying an invented quote forward. This is not fussiness: the stored string is later
spoken aloud to a receptionist in the patient's name, so a quote she never said would
put words in her mouth to a third party.

## Stop Conditions are enforced twice

The two layers are not interchangeable, and neither replaces the other. See
[ADR 0005](../../docs/adr/0005-stop-conditions-are-enforced-twice.md).

1. **In the call, for the patient.** The agent reads the fixed Safety Line and ends
   the call kindly. Nothing is improvised — a model improvising here is a model giving
   medical advice.
2. **After the call, for the practice.** A deterministic scanner reads the finished
   transcript and decides whether the Review Item is flagged. It is the authority, and
   it flags even when the agent sailed through all four questions without stopping.

A Stop Condition is a surface condition, not a judgement: a phrase on the red-flag
list, an answer that maps to no bounded field, repeated confusion, a third party on the
line, or a clinical question put to the agent. The agent matches. It never grades
severity.

Use [`references/red-flags.md`](references/red-flags.md) as the single list. Both the
prompt builder and the scanner read it through the same loader, so the two cannot
drift apart. Do not hand-copy phrases into a prompt.

## Safety

Read [`references/safety.md`](references/safety.md) before placing any live call.
Worked results, including the outcomes that look like failures and are not, are in
[`references/examples.md`](references/examples.md).
