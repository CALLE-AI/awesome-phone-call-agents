# The Booking Envelope

The contract the **Rebooking Call** runs under. Read this before the second call, and
read [`safety.md`](safety.md) before either.

A **Release** does not say "yes". A boolean would authorise a call and then leave the
agent to decide what counts as a good outcome on the phone, which is the decision the
practice is trying not to delegate. So a Release carries an envelope — a short range of
days and a small set of narrowings — plus the words the Reviewer approved. Everything
the agent may accept is inside it, and everything else goes back to a person.

See [ADR 0003](../../../docs/adr/0003-a-release-grants-a-bounded-authority.md).

## What a Release carries

| Field | Meaning | Left open |
| --- | --- | --- |
| `earliest_date` | ISO date. Nothing before it. | Never — always set |
| `latest_date` | ISO date. Nothing after it. | Never — always set |
| `time_of_day` | `morning`, `afternoon`, or `any` | `any` |
| `mode` | `in_person`, `telephone`, or `any` | `any` |
| `clinician` | A named clinician | `null` |
| `approved_words` | The patient's own sentence, or empty | Empty is valid |
| `reviewer_name` | Who granted it. Never a role, never blank | Never |

Two rules on the envelope itself, both refused at the point of Release rather than
discovered on the phone:

- `earliest_date` must not fall after `latest_date`.
- The span must be **31 days or fewer**. Beyond a month, two of the same day-of-month
  fall inside it and the day match below becomes ambiguous. A Reviewer authorising five
  weeks has not narrowed anything, so this is a limit on the Release, not a shortcoming
  of the matcher.

`approved_words` may legitimately be empty — the Reviewer can release the appointment
without releasing the quote. "I'm only able to pass on what she said" is then the whole
of what the agent carries, and that is a complete call rather than a failed one. See
[ADR 0009](../../../docs/adr/0009-the-board-defaults-to-silence.md).

## What the agent is told aloud

Only the fields a Reviewer actually narrowed are spoken. A field left open needs no
confirmation from reception; a field narrowed must be heard back before the agent may
accept. That keeps the call short for the practice that did not care and strict for the
one that did.

`mode` and `clinician`, when set, carry the same extra sentence: *only accept if you
hear them say so; if they do not say it, do not assume it and do not accept.* Silence
is not agreement — a receptionist who never mentions "face to face" has not offered it.

The agent never asks for something else, never explains why an offer does not fit, and
never negotiates. It says it cannot take it, says it will be passed back to the
practice, and thanks them.

## The Envelope Match

Reception says *"Wednesday the 26th, ten past nine."* That is not a date. Turning it
into `2026-08-26` needs a year, a month, and a rule for what "Tuesday" means when today
is a Friday — three resolutions, each silent when wrong, and a wrong one books a patient
into a slot nobody offered.

So the question is inverted. The envelope is already a short list of days, so we ask the
smaller question: **does this turn name a day the envelope holds?**

1. Read day-of-month numbers and weekday names out of the reception turn. Deliberately
   dumb — this is reading which days were named, not resolving a date.
2. Filter the envelope's own days by both.
3. **Exactly one survivor** → `inside`, and that date is the match.
   **None** → `outside`. **More than one** → `unreadable`.

An envelope of a fortnight holds one 26th, so "the 26th" resolves without a calendar. It
holds two Tuesdays, so a bare weekday is ambiguous and flags rather than taking the
nearer one. A turn naming no day at all is `unreadable` — never a guess.

Then the clock, against **practice hours of 08:00–18:30**:

- No time given: `inside` when `time_of_day` is `any`, `unreadable` otherwise — an offer
  with no time in it cannot be shown to satisfy a half of the day, so it is not claimed
  to.
- Outside practice hours: `unreadable`. This is what catches a transcription of 21:10
  for "ten past nine". It is never quietly corrected.
- Inside: the half of the day is compared against `time_of_day`. From 12:00 it is the
  afternoon.

See [ADR 0008](../../../docs/adr/0008-an-offered-slot-is-matched-never-resolved.md).

## Reception revises, so every offer is kept

She offers 09:10, the agent accepts, and then she says that slot has just gone and
offers 08:50 instead. People revise; a front desk revises constantly.

So the result carries a **list** of offers, each anchored to the turn it was spoken in
and each marked accepted or not. The agent may accept again while reception waits. The
**Binding Acceptance is the last accepted offer**, and that is the one matched against
the envelope. The earlier offers are kept as evidence, not overwritten — when a human
rings back, the question is almost always "what was actually said?", and the withdrawn
09:10 is the reason the booking is 08:50.

An accepted offer that a later turn withdraws must not leave a booking behind it. The
status follows the last acceptance, not the first.

See [ADR 0012](../../../docs/adr/0012-the-last-acceptance-binds-and-every-offer-is-kept.md).

## Matched twice, for two different readers

The agent judges the offer on the phone, because CALL-E has no callback mid-call and
somebody has to answer the receptionist while she waits. Then the finished call is
matched again, deterministically, against the release row that authorised it.

These are not the same check twice. The first exists for the receptionist: it is what
lets the call move at the speed of a conversation. The second exists for the practice:
it is what makes "the agent only accepts inside the envelope" a property of the code
rather than a request made of a model.

See [ADR 0007](../../../docs/adr/0007-the-agent-accepts-the-board-checks-the-acceptance.md).

## What the outcome may be

| Board status | When |
| --- | --- |
| `booked` | Something was accepted and the Binding Acceptance is `inside` |
| `reception_declined` | Reception said they cannot book for a third party |
| `needs_review` | Anything else with a finished call |

`needs_review` covers three different things, and none of them is reception refusing:
no slots were offered, the call ended unclearly, or **the agent accepted something the
envelope does not allow**. That last one is worse than a refusal, because reception
believes a booking exists — so it goes back to a named human rather than being filed as
a success.

A patient never declines on this call. She is not on it. A `DECLINED` from the platform
here is the booking line rejecting us, not her.
See [ADR 0010](../../../docs/adr/0010-a-rebooking-outcome-is-not-a-checkin-outcome.md).

## What is never written

`followup_booked` is never set, whatever reception says. The system records that she
said she booked it, which is a fact about a phone call. Whether an appointment exists is
a fact about the practice's own book, and not ours to claim.
See [ADR 0001](../../../docs/adr/0001-no-agent-write-path-to-the-clinical-record.md).

## One call per Release

The idempotency key is `rebooking:{release_id}`, `UNIQUE` in the schema and on disk
before anything is submitted. Pressing Run twice reports what happened the first time.
A submission whose outcome came back unknown is never redialled — the way out is the
provider's own recovery command.
See [ADR 0006](../../../docs/adr/0006-a-refusal-is-not-a-missed-call.md).
