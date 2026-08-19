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
