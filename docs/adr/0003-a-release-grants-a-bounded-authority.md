# A Release grants a bounded authority, not an approval

A Reviewer releasing a Review Item does not toggle a flag saying "yes, call them".
The Release carries a Booking Envelope — date range, time of day, appointment mode,
clinician constraint — and the exact Carried Words that may be spoken.

We need this because "the agent never decides anything on its own" and "the agent
places the rebooking call" are in direct tension the moment reception offers a slot.
Someone has to answer. Modelling the Release as an envelope resolves it: the agent
is executing a decision a named human already made, and any offer outside the
envelope is refused and returned to the board rather than negotiated.

`skills/human-context-handoff/` enforces the same shape from the other direction — a
returned rationale may narrow the chosen action but may never grant new authority.

## Consequences

The board's release control is a small form, not a button, and reviewing costs more
than one click. The envelope is also the audit trail: what was accepted is always
provably inside what a named human authorised.
