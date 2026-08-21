# The last acceptance binds, and every offer is kept

Reception offers Tuesday the 26th at ten past nine, the agent accepts, and then she says
that slot has just gone and offers ten to nine instead. People revise; a front desk
revises constantly. A matcher that assumes one Offered Slot per call has no answer here,
and the wrong answers are both bad: refusing the revision throws away a call that was
succeeding, and reporting the first slot books Margaret into a time nobody holds.

So the result schema carries a list of offers, each anchored to the turn it was spoken in
and each marked accepted or not. The agent may accept again as long as the new offer is
inside the envelope, and the binding acceptance is the last one. The Envelope Match reads
that last acceptance; the earlier offers are kept as evidence rather than discarded.

Keeping them is not tidiness. When a human rings back — because the match failed, or
because reception refused, or because the Patient asks what happened — the question is
almost always "what was actually said?", and a single overwritten field cannot answer it.
The withdrawn 09:10 is the reason the booking is 08:50.

## Consequences

The matcher checks one offer and stores several, so `rebooking` needs a child table rather
than four columns on `release`. An accepted offer that a later turn withdraws must not
leave `booked` behind it — the status follows the last acceptance, not the first. A call
in which every offer falls outside the envelope is not a refusal by reception and must not
be filed as one: nothing was refused, nothing fitted.
