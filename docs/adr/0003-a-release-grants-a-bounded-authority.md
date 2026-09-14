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

## Amendment — silence satisfies only what the Reviewer left open

The envelope carries four constraints and reception speaks to two of them. She names a
day and a time; she does not say whether the appointment is in person, and she does not
say which clinician. If silence failed the envelope, every Rebooking Call would have to
interrogate a busy receptionist about fields the Practice may not care about — and an
agent that interrogates reception is the fastest way to get this product banned from a
practice.

So the authority is read the way it was granted. A field the Reviewer left open needs no
confirmation; a field the Reviewer narrowed must be heard aloud or the offer fails.
Tightening the envelope is what makes the call longer, and the Reviewer chooses that
trade knowingly, for one Patient at a time.

This requires `AppointmentMode` to carry `ANY`. `TimeOfDay` already has it; its absence
from `AppointmentMode` was an oversight, not a position. `release.mode` stays `NOT NULL`
and always holds a value — a nullable column would give "unconstrained" two spellings,
and the one that is never read is the one that rots. Without it every Release narrows the mode by construction, every call must ask,
and the rule collapses into the interrogation it was written to avoid.
