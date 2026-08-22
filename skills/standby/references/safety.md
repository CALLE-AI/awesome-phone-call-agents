# Safety

This skill causes a machine to telephone real people, early in the morning,
about work. Every rule below exists to keep that acceptable to the person who
picks up.

## Consent is the roster

The skill never sources, guesses, completes or reformats a phone number. Numbers
arrive from the user, who confirms the roster is a standby list whose members
expect these calls.

Anyone marked opted out is skipped **before dialling**, and the skip is recorded
with its reason. A silent skip is indistinguishable from a bug, and a person who
asked not to be called needs that request to be visibly honoured, not invisibly
honoured.

## One call in flight

Enforced, not advised. A second concurrent call is an error the implementation
raises, not a fast path it takes.

Two calls in flight can produce two acceptances for one shift. The supervisor
then has to un-invite someone who has already got out of bed — worse for that
person than never being called, and the fastest way to empty a standby list.

## Quiet hours

Default 22:00-05:00 local to the shift. The override that permits a call inside
them exists only when the shift starts within ninety minutes, and it is a number
the employer sets in policy — never a judgement the agent makes during a call.

Ringing a standby list at 23:00 about a shift two days out is how a workforce
stops answering.

## The agent does not negotiate

The call goal states the shift and asks yes or no. It does not offer pay, hours,
terms, or anything the user did not write down. An agent improvising terms on
the phone binds an employer to something nobody approved, and the callee has no
way to know a machine just invented it.

## Nobody is worn down

One retry for a no-answer, at the end of the list. Never an immediate redial.
Nobody is rung a third time. A second callback request is treated as a decline.

## Reading the answer conservatively

Anything that is not a clear yes is not a yes. An unparsable call is recorded as
a decline **and marked unparsed**, so "they said no" and "we could not tell"
stay distinguishable in the log. See `references/reading-the-answer.md`.

## Everything is logged

Every attempt records its time, its outcome and its transcript. When someone
asks a week later why they were called at 05:40, or why they were not called at
all, the answer exists.

## Cancellation

Because only one call is ever in flight, stopping the cascade stops everything
except the call already ringing. There is no queue to drain and no scheduled
work left behind.

## Test numbers only in samples

Every number in this skill's examples is inside a reserved test range that
cannot reach a person. Real numbers never appear in documentation, fixtures, or
a demo recording.
