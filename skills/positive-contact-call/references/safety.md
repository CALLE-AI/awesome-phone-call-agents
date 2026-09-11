# Safety

The people this call reaches are, by construction, the people least able to absorb a
mistake: enrolled in a medical equipment programme, often elderly, often not native
speakers of the language the call is placed in, and about to lose power. Everything below
follows from that.

## Disclosure comes first

The first thing the call says, before any question, is who is calling, that the call is
automated, and that it may be recorded.

> This is an automated safety notification from {organisation} about {notice}. This call
> may be recorded.

Not after the notice. Not on request. First. A person who hangs up during the disclosure
has still been told who called them.

## The call never asks for anything

Utility impersonation is one of the most common phone scams, and it works because a real
utility call and a scam call sound alike. This call is built to be trivially
distinguishable from the scam version: it asks for nothing.

Never ask for, and never accept if offered:

- an account number, a customer number, or a meter number
- a card number, a bank detail, or any payment
- a date of birth, a government identifier, or an address to "confirm"
- a password, a PIN, or a one-time code

The only identity question permitted is: "Am I speaking with {first_name} or someone in
the household?" That is a routing question, not a verification question, and the call
proceeds the same way whoever answers.

Never discuss account status, billing, arrears, credit, or disconnection for non-payment.
Never offer to change the timing of the event. Never offer a discount, a credit, or a
callback from anyone other than the named support team.

## The medical boundary

The programme flag means the account is enrolled. It does not mean the call knows
anything about the person's health, and it must never behave as though it does.

If the recipient asks anything about medical equipment, health, or what they should do
medically, the call:

1. says that a member of the team will call them back about it,
2. sets `needs_assistance` to `medical_question`,
3. ends politely.

It gives no advice. It gives no reassurance about whether equipment will keep running. It
does not suggest a backup battery, a generator, a hospital, or a duration. It does not say
"you will be fine". Those are clinical judgments, and a phone agent has no business making
them.

The question itself is recorded as having happened. What the person said about their
health is not.

## No protected health information

No field anywhere in this workflow records a condition, a device, a diagnosis, a
medication, or a treatment. Not in the result schema, not in the notes field, not in a
fixture, not in a log line.

A recipient may well mention their equipment on the call. That is their choice, and the
transcript is retained under the retention rule below. But nothing is extracted into a
structured field, and the free-text note passed to the operator is instructed to carry
none of it. The note is for routing ("asked about powered equipment, routed to a person"),
not for describing a person's health.

## Numbers are masked everywhere

The raw E.164 lives in exactly one place: the access-controlled contact record. Every
other surface gets a masked form, `+1415<dots>0142`: logs, previews, the operator
dashboard, reports, work-order exports, audit rows, and test output.

Free text coming back from a call is passed through a conservative redactor before it is
stored outside the contact record: phone-shaped runs are masked, runs of seven or more
digits are removed, and email addresses are removed.

## Retention

Raw transcripts are kept only as long as the review window for the event, which defaults
to 30 days and is configurable. Evidence spans, which are the short quoted fragments a
disposition relied on, are kept longer, because they are the justification for a decision
that may be reviewed later.

Nothing about a call is kept forever by default.

## Authorization binding

Every call records why this number may be called about this notice. A call with no
recorded authorization is refused rather than placed.

A wrong-number outcome retires that number for the event. Nothing dials it again, on any
ladder step, for any reason. A refusal does the same.

## Numbers are never repaired, and timezones are never inferred

A number that is not already E.164 is a data defect, and the fix belongs upstream. Adding
a country code is a guess, and a guess dials a stranger.

A timezone comes from the roster or from the event default, and nowhere else. It is never
inferred from a phone number, a country code, a locale, an IP address, or a UTC offset.
Quiet hours computed from a guessed timezone wake somebody at three in the morning.

## Quiet hours

Calls are placed inside the recipient's local calling window. Quiet hours are respected by
default. An emergency override exists because there are genuine emergencies, but it is off
by default, it must be set deliberately per event, and it is printed in the preflight
preview so nobody enables it by accident.

## Language

A call is placed only in a language supported on the destination line. When the
recipient's language is not supported, the correct action is a bilingual human callback,
not a call in a language they did not ask for. Delivering a safety notice to somebody who
cannot understand it is not delivery, and recording it as contact would be worse than not
calling.

If a language barrier surfaces during a call, the call ends politely and the contact is
routed to a person. It is not retried in another language.

## The cancellation boundary

Once a call has been submitted and an id has come back, it cannot be recalled. The
platform publishes no cancel endpoint. Any interface that suggests otherwise is lying to
the operator.

What can be stopped is everything that has not happened yet: no further ladder steps are
scheduled, no retries are placed, and the run stops submitting. Say that plainly rather
than offering a cancel button that does not cancel.

## Fail closed, in every direction

Ambiguity is never resolved in favour of "contacted". An unreadable result, a missing
result, a disagreement between the structured result and the transcript, a confidence
score below the gate, a status that is not a clean completion: each of these opens human
review or advances the ladder. None of them confirms a contact.

The cost of a false negative is a wasted call or an unnecessary visit. The cost of a false
positive is somebody on powered medical equipment who was recorded as warned and was not.
