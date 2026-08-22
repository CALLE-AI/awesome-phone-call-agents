# Cascade rules

The source of truth for ordering, retries and stopping. Every rule here exists
because the obvious alternative produces a worse morning for a real person.

## Ordering

At each step, choose in this order:

1. **A callback whose time has arrived.** Someone who said "ring me back at
   05:50" has already half-agreed; they outrank an untried name.
2. **The next untried person, in the order the user supplied.** That order is
   the employer's business rule — seniority, fairness, who lives nearest, who
   is cheapest. The skill honours it and never invents one.
3. **The second sweep**: people who did not answer the first time.

## One call in flight

Never dial a second person while a call is ringing. This is the rule the whole
skill exists to enforce.

Twenty simultaneous calls is one line of code and produces four people arriving
for one shift. The supervisor now has three awkward conversations and a
reputation problem with the standby list — strictly worse than the original
open slot.

## No-answer

One retry, at the end of the list, never immediately.

Ringing someone twice inside a minute at 05:40 is how people leave a standby
list. Waiting until everyone else has been tried also gives them time to notice
the first missed call and ring back on their own.

Nobody is rung a third time.

## Callback

If the callee names a time, requeue them for it. If they name no time, use ten
minutes.

A second callback request from the same person is treated as a polite decline.
It usually is one, and the alternative is a person who can be rung all morning.

## Quiet hours

Default 22:00–05:00 local to the shift. Inside them, do not dial.

**The exception that makes it usable:** if the shift starts within ninety
minutes, dial anyway. A 06:00 shift is exactly the case where you *do* ring at
05:40 — the alternative is nobody turning up at all. Set the override to null
to forbid it absolutely.

This is a policy number the employer sets, never a judgement the agent makes on
the call.

## Cutoff

Stop when the shift starts, or earlier if a margin is configured. A "yes" that
arrives after the shift began is not a fill, and continuing to ring people
about a shift they can no longer take wastes their goodwill.

## Stopping

- **Accepted** — stop immediately. Everyone still queued is explicitly stood
  down and recorded as such. Leaving them "queued" forever reads, in the log,
  as though the cascade simply stopped, and the difference matters when someone
  asks a week later why person 7 was never called.
- **Exhausted** — say so plainly. The list ran out; a human decides what happens
  to the shift. Do not loop.
- **Cutoff** — the shift started.
- **Aborted** — the user stopped it.

## Late acceptance

If the accepted person's stated arrival is after the shift starts, still stop —
a second person turning up mid-shift is worse — but report the shortfall in
minutes. "Filled" in green when the replacement arrives 110 minutes late is a
lie the supervisor will discover at 06:00.
