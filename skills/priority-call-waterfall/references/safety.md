# Safety Reference

A waterfall run places several real phone calls from one authorization. That
concentration of side effects is exactly why the boundaries below are strict.

## Explicit Intent

Run a waterfall only when the user clearly asks for one specific opening to be filled
by phone. One confirmation covers one run over one candidate list. A new opening, an
edited list, or a re-run over the remaining candidates each needs fresh confirmation.

Show a masked preview (opening, calling order, cap, deadline) and get explicit
approval before the first call.

## One Acceptance Ends Everything

The moment any candidate accepts:

- no further calls may start, including any already "planned" but not yet placed
- the outcome is recorded against exactly that candidate
- remaining candidates are reported as not called

Offering one opening to two people is a real-world double-booking with two humans who
each believe they said yes to something. Every other rule in this file bends before
this one.

## Sequential, Capped, Bounded

- Strictly one candidate on the line at a time. No parallel dialing, no racing.
- At most one call per candidate per run — a busy line or voicemail is a decline for
  this run, not an invitation to retry.
- Honor `maxCalls` and `deadline` exactly. A run that cannot finish before the
  deadline reports itself unfilled rather than calling past it.

## Ambiguity Is a Decline

Voicemail, no answer, a dropped call, a failed call, an unclear or conditional answer
("maybe", "call me back later", "let me check") — all of these are declines for this
run. Only a clear affirmative captured in the structured result's `accepted` field
books the opening. When in doubt, the opening stays open and a human follows up.

## Phone Numbers and Consent

- E.164 numbers only. Documentation examples use reserved fictional numbers such as
  `+15550101234`.
- Mask numbers in every user-facing summary, report, log, and commit. The full number
  exists only in the call execution itself.
- Candidates must have an existing relationship that makes the call expected: a
  waitlist they joined, a staff roster, an on-call rotation they are part of. Cold
  lists are not waterfall material. If that expectation is unclear, ask before
  calling.

## Content Boundaries

Openings in medical, legal, financial, or emergency contexts are handled as pure
logistics: the goal names the service, the time, and asks yes or no. The call gives
no medical, legal, or financial advice, and an emergency escalation waterfall is a
notification chain, never a substitute for emergency services.
