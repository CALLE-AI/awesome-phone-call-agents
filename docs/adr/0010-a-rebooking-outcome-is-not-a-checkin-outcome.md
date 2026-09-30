# A Rebooking Call's outcome is not a Check-in Call's

ADR 0006 gave `DECLINED` a meaning: the Patient answered, heard a machine, and hung up.
Suppressing the redial follows from that meaning. On the Rebooking Call the same code maps
the same word to the same status, and the board then tells the Practice that Margaret does
not want these calls — about a call Margaret was never on. What declined was the surgery's
own switchboard.

`review_status_for` therefore takes the call kind. For a Check-in Call `DECLINED` stays
`declined`. For a Rebooking Call it becomes `not_reached`: nobody was reached, and a human
rings. Unrecognised outcomes still fall to `needs_review` in both directions, so a
vocabulary we have not met reaches a person instead of producing a wrong sentence.
Upstream #206, #82 and #111 all report that the platform cannot yet separate a callee
declining from a call that never rang, which is why this mapping is ours rather than the
provider's.

A receptionist refusing a third-party booking is a different thing again: the call
completes, the platform reports `COMPLETED`, and the refusal exists only in what she said.
The result schema carries `reception_outcome` as a closed enum together with the turn it
was spoken in, and our code checks the turn exists and the speaker is reception before
mapping it. `unclear`, or a claim that does not anchor, falls to `needs_review`.

That check is deliberately lighter than the Stop Condition scan, and the asymmetry is the
point. A red-flag list must be deterministic because it is clinical; misreading a
receptionist costs one human reading one transcript. `reception_declined` is still worth
recording rather than collapsing, because three of them in a week is the Practice learning
something true about its own front desk.

Finally `ReviewStatus` gains `booked`, and terminal splits in two. One set blocks a human
from acting on an item twice; the writer of the second call's outcome may still move
`released` onward to `booked`, `reception_declined`, `not_reached`, or back to
`needs_review`. Without that split, a Release is the last thing that can ever happen to a
Review Item and the call it authorises has nowhere to land — `review.py:25` listed
`released` as terminal and `terminate()` refused to move it.

## Consequences

`holdfor/outcomes.py` stays the single home of provider vocabulary, as ADR 0006 requires,
and now knows there are two calls. The board's day count can distinguish an item a human
closed from one the agent booked, which is what makes the ratio in the demo readable at
all: nine closed and three needing you says nothing if a booking and a dismissal share a
status.
