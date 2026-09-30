# No agent write path to the clinical record

The agent has no write access to the practice's clinical system — not gated, not
permissioned, absent. Check-in Call results land in this workflow's own store and
on the review board; if something belongs in the record, a Reviewer reads it and
types it in themselves.

## Considered options

`apps/python/sentinelcall-anc-followup/` in this repository takes the other path:
it writes a FHIR `Observation` with status `preliminary` after an explicit
human-confirmed escalation, and a human promotes it to `final`. That pattern is
proven here and is a reasonable design.

We rejected it because our patients are older and the failure is asymmetric. A
preliminary row authored by an agent is still agent-authored text sitting inside
an elderly patient's record, where a later reader may not notice who wrote it or
that it was never promoted. Having no write path at all is the only version of
this we can defend without knowing how each practice's staff actually treat
preliminary rows.

## Consequences

Nothing the agent produces can ever become the clinical record by inaction. The
cost is real: a Reviewer retypes, and the workflow store and the record can drift.

## Amendment — nor do we keep a shadow of it

`appointment.followup_booked` sits in our own SQLite, so writing it breaks no rule about
the practice's clinical system. We still do not write it. It is read and seeded and
nothing in the app ever updates it.

A successful Rebooking Call ends with a receptionist saying she has booked something. That
is what we heard, and it is all we know. `review_item.status` becoming `booked` records
exactly that — a fact about a phone call. Setting `followup_booked = 1` would record
something else: a claim about the practice's appointment book, made by us, about a row we
cannot see and cannot reconcile.

The two come apart in the ordinary case. Reception mistypes the date, or the booking is
undone an hour later, or she meant to book it and did not. The clinical system then holds
no appointment while our column says there is one, and nothing anywhere in this system can
find the disagreement. Having no shadow of the record is the same defence as having no
write path to it: we are not in a position to keep a copy honest, so we do not keep one.

## Consequences

The board answers "did reception say she booked it?" and never "is she booked?". Those are
different questions and only the first one is ours. A Practice that wants the second answer
looks in EMIS, which is where the answer actually lives.
