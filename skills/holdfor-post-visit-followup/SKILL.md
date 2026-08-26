---
name: holdfor-post-visit-followup
description: Place one consent-gated post-appointment check-in phone call to an older patient on behalf of a practice, return five enumerated answers plus a verbatim patient quote, and stop the call rather than answer anything clinical. Then, only after a named human releases it, place a second call into the practice's own booking line carrying that quote and a bounded range of dates. Never books unilaterally, never advises, never asks the patient to confirm personal details.
license: MIT
---

# HoldFor post-visit follow-up

Two phone calls with a named human between them.

1. The **Check-in Call** rings a patient a few days after an appointment, asks five
   bounded questions at her pace, and returns a structured result.
2. A member of practice staff reads it and grants a **Release**, or does not.
3. The **Rebooking Call** rings the practice's own booking line inside that Release,
   carrying her own words.

Nothing in step 3 can happen without step 2. That is the whole shape of the skill.

Terms in bold with a capital are defined in the repository's `CONTEXT.md` and are
load-bearing. Do not substitute "ticket" for **Review Item**, "approval" for
**Release**, or "escalation" for **Stop Condition**.

## What this skill does not do

Neither call decides anything clinical, and neither writes to a patient record. There is
no write path to the clinical record, by design and not by omission. See
[ADR 0001](../../docs/adr/0001-no-agent-write-path-to-the-clinical-record.md).

The Check-in Call carries no authority to cause the Rebooking Call. A patient saying yes
is an answer, not an instruction — only a **Release**, granted by a named human who read
the transcript, places the second call. See
[ADR 0003](../../docs/adr/0003-a-release-grants-a-bounded-authority.md).

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

## Call one — the Check-in Call

Read [`references/call-task.md`](references/call-task.md) for the authored wording. It
is the source of truth for what the agent says, and the sentences marked fixed are
pinned by tests because each one carries a promise.

Five questions, four bounded and one open:

| # | Question | Field |
| --- | --- | --- |
| 1 | Since {weekday}, are you feeling better, about the same, or worse? | `feeling` |
| 2 | Are you getting on alright with what they gave you? | `medication_ok` |
| 3 | Is there anything worrying you? | **Carried Words** |
| 4 | Would you like the surgery to see you again? | `wants_seen` |
| 5 | Are mornings or afternoons easier for you? | `when_easier` |

Two of them are conditional, and the condition is enforced after the call rather than
trusted to the agent. Question 2 is asked only when the appointment changed her
medication. Question 5 is asked only when she said yes to question 4 — putting it to
somebody who has just declined presses her towards an appointment she did not want.
Either way the field records `not_asked`, which means *nobody put this to her*, not
*she had no answer*.

Question 5 books nothing and promises nothing. The agent may not say a time is
available, offer one, or tell her when she will be seen: no human has read the call yet.
A patient who names a weekday rather than a half of the day is recorded `unsure` — the
envelope has no room for a weekday, and inventing a half-day would put a constraint in
her mouth she never gave.

The result shape is [`references/result-schema.json`](references/result-schema.json).

## Call two — the Rebooking Call

Read [`references/envelope.md`](references/envelope.md) for the contract: what a Release
carries, how an offered slot is matched, and what the outcome may be.

Three rules stand out and are worth knowing before reading it.

**It speaks from a closed list.** The practice's own name, what the Release contains,
and the patient's identifiers. Nothing else. Anything reception asks outside those three
is answered with one fixed sentence and then the call returns to scheduling. The name
goes out in the opening; the date of birth waits to be asked, so a call that reached a
wrong number has disclosed a name and nothing more. See
[ADR 0011](../../docs/adr/0011-the-rebooking-call-speaks-from-a-closed-list.md).

**An offered slot is matched, never resolved.** "Wednesday the 26th" is not a date. The
agent does not turn it into one — the envelope is asked whether it holds a day this turn
named, and two candidates means neither. See
[ADR 0008](../../docs/adr/0008-an-offered-slot-is-matched-never-resolved.md).

**Reception revises, so every offer is kept.** The Binding Acceptance is the *last*
accepted offer; the earlier ones stay as evidence. When a human rings back, the
withdrawn 09:10 is the reason the booking is 08:50. See
[ADR 0012](../../docs/adr/0012-the-last-acceptance-binds-and-every-offer-is-kept.md).

## The Never-Ask Rule

The check-in call asks for no date of birth, no address, no NHS number, and nothing
resembling payment — and it says so aloud.

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

A Reviewer may narrow the quote before releasing it, or release none of it at all. See
[ADR 0009](../../docs/adr/0009-the-board-defaults-to-silence.md).

## Stop Conditions are enforced twice

The two layers are not interchangeable, and neither replaces the other. See
[ADR 0005](../../docs/adr/0005-stop-conditions-are-enforced-twice.md).

1. **In the call, for the patient.** The agent reads the fixed Safety Line and ends
   the call kindly. Nothing is improvised — a model improvising here is a model giving
   medical advice.
2. **After the call, for the practice.** A deterministic scanner reads the finished
   transcript and decides whether the Review Item is flagged. It is the authority, and
   it flags even when the agent sailed through all five questions without stopping.

A Stop Condition is a surface condition, not a judgement: a phrase on the red-flag
list, an answer that maps to no bounded field, repeated confusion, a third party on the
line, or a clinical question put to the agent. The agent matches. It never grades
severity.

The Safety Line is placed **before** the red-flag list in the prompt, not after it. An
early "stop the call" imperative followed by ninety-odd phrases is a model that stops
without speaking, and a line going dead is the worst answer available to somebody who
has just described chest pain. The line names where to turn, ends with her name the way
every other exit from the call does, and is said in full before the call ends.

A flagged Review Item cannot be released at all. The board's answer to it is "ring them
myself", not a second agent placed against the call the first one correctly refused.

Use [`references/red-flags.md`](references/red-flags.md) as the single list. Both the
prompt builder and the scanner read it through the same loader, so the two cannot
drift apart. Do not hand-copy phrases into a prompt.

## Safety

Read [`references/safety.md`](references/safety.md) before placing any live call.
Worked results, including the outcomes that look like failures and are not, are in
[`references/examples.md`](references/examples.md).
