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

Anything that is not a clear yes is not a yes — and anything that is not clear
at all is not a no either.

A call the skill cannot read **stops the cascade** and waits for a person. It is
not scored as a decline, because a decline advances the list and that quietly
harms two people at once: the one who may have been saying yes into a dropping
line and is silently passed over, and the next one, rung about a shift that may
already be taken. Neither leaves a trace afterwards — the log would read
"declined" and the morning would look ordinary.

An earlier version of this skill recorded unreadable calls as declines with an
`unparsed` flag beside them. The flag was honest and the behaviour was not: the
cascade moved on regardless, so operationally an unreadable call *was* a no.

While a call is held, no further call is placed — attempting one is an error,
not a slow path — and nobody is stood down. Resolving it requires a person, a
name recorded in the log, and a real outcome. See
`references/reading-the-answer.md`.

## Everything is logged

Every attempt records its time, its outcome and its transcript. When someone
asks a week later why they were called at 05:40, or why they were not called at
all, the answer exists.

## Cancellation

Because only one call is ever in flight, stopping the cascade stops everything
except the call already ringing. There is no queue to drain and no scheduled
work left behind.

## Withheld numbers only in samples

Every number in this skill's examples is inside a range a regulator or a network
operator has permanently withheld from allocation. Not a range that looks
unused — one that is guaranteed never to be issued:

| Range | Withheld by |
|---|---|
| `+49 176 040690 00`–`99`, `+49 171 39200 00`–`99` | German mobile network operators, for media use |
| `+49 30 23125 000`–`999` and four other city blocks | Bundesnetzagentur, for film and television |
| `+44 7700 900000`–`900999` | Ofcom, drama range |
| `+1 NPA 555 0100`–`0199` | NANPA, fictional use |

The distinction matters and this skill got it wrong once. Numbers in live German
mobile prefixes with a run of zeroes behind them *look* synthetic and are not:
they are unallocated only until the day they are allocated, after which they
belong to somebody who never agreed to appear in a demo. **"Looks fake" is not a
property a phone number has.**

The reference implementation enforces this mechanically rather than by review —
`scripts/test-numbers.mjs` scans every file in the repository, including prose,
and fails on any number outside those ranges.

## Nothing recorded from a real call is published

No transcript, recording, provider identifier or screenshot taken from a real
conversation belongs in a public repository, a demo, or documentation — not even
with the destination number scrubbed. Consent to receive one call is not consent
to be published and cloned indefinitely, and a transcript is a recording of a
person speaking.

The fixtures the reference implementation replays are **written, not recorded**,
and ship with the generator that produces them so anyone can regenerate and diff
rather than take the word "synthetic" on trust.
