# Safety Reference

Concord dials real workplaces and evaluates what the people there said. The
risk it carries is not the call, it is what the output could be turned into.
Default to preview and stop whenever ownership of a line is uncertain.

## The surveillance boundary

A tool that phones your own staff and scores their answers is one design
decision away from being a surveillance tool. Concord draws that line in code
rather than in a paragraph:

- `Finding` has no field for a name, role, employee number or phone number.
  There is nowhere to put a person, so per-person output is not a setting that
  can be switched on.
- The one free-text field is the spoken quote, and it is the one way a name
  could enter the record. `Answer.parse` strips self-identification ("This is
  Sarah", "Priya speaking") and caps quote length before the value is stored.
  Pattern matching on natural speech is best effort, not a proof: treat the
  schema as the guarantee and the quote scrub as defence in depth.
- The call task instructs the agent not to ask for the name or role of whoever
  answers, and not to record it if offered.
- Branches are ordered by outstanding policy work. There is no score, no
  percentage and no league table, because those are the artifacts that end up
  in an appraisal.
- Rendered reports contain no phone numbers.

Tests assert each of these. If a change makes individual attribution possible,
the suite fails.

The product claim is narrow on purpose: Concord tells an operator which
locations give callers the wrong answer. It does not tell them who to blame.

## Authorisation

Every branch needs a written authorization reference tying that line to the
operator's own estate. Possession of a number is not authorisation, and a
branch without a reference is refused at parse time.

Concord audits an operator's own locations. Calling lines you do not own to
score their staff is out of scope, and helping a user work around the
authorization requirement is not a supported use.

## Disclosure

The call opens by stating that an AI assistant is calling on behalf of the
named organisation to check the information given to callers, and that this is
not a test of the individual answering. Covert mystery shopping is not
supported.

## Phone numbers

E.164 required. Documentation and fixtures use reserved 555 numbers. Numbers
are masked in previews and absent from reports; the full number appears only in
the provider payload.

## Conduct during the call

The agent asks as an ordinary caller would and accepts the first clear answer.
It must not coach, correct, argue with or grade the person answering, and must
not state what the policy says. Telling a branch the right answer mid-audit
both contaminates the finding and turns a measurement into an unrequested
performance conversation.

## Ambiguity

A hedged, partial or refused answer is recorded as `unclear`, never rounded to
the nearest option. A value outside the rubric's options is unresolved rather
than coerced. An unreached branch is `UNCLEAR`, never a deviation, so a phone
line that failed cannot be read as a policy breach.

This direction matters more than the reverse. A missed deviation costs a second
audit. A false deviation costs someone an unfair conversation with their
manager.

## Execution gate

A live run is accepted only when all three hold, checked independently:

1. `--live` is present.
2. `--confirm` matches the token printed by the current preview. The token is
   derived from the audit and rubric, so editing either invalidates it.
3. The current time is inside the branches' local weekday call window.

A failed gate exits non-zero and places no call.

## Duplicate audits

The idempotency key is derived from the approved audit, not the attempt. After
an uncertain response, resubmit the same unchanged audit and reconcile by call
id. Never start a second audit because polling timed out: the branches would be
called twice.

## Scope limits

At most twelve branches in one run. Concord is not for emergencies, and not for
medical, legal or employment decisions. A finding is evidence that a caller was
given a particular answer. It is not proof of misconduct.

## Retention

Concord does not persist transcripts or numbers unless the operator states a
retention purpose and location. Quotes in a report are the minimum needed to
show why a finding was made.
