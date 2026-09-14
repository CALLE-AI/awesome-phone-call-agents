# Reference implementation: GovOS

[GovOS](https://github.com/shubhangi-mish/agents-for-humans/tree/main/govos)
is a Strands Agents-based autonomous incident-response system for Delhi
(built for a separate hackathon), included here as a real, tested production
use of this exact pattern rather than a hypothetical.

## Where it's authorized

GovOS runs several Strands agents (Intel, Resource, Policy, Comms,
Orchestrator) that investigate a real-world incident signal, dispatch
response units, and auto-authorize actions that exceed field-level scope
under real delegated-authority tiers — a District Magistrate tier for
routine emergency spend, a Police Commissioner tier for law-and-order
actions, and a DDMA (Delhi Disaster Management Authority — chaired by the
Chief Minister) tier for city-wide or high-value sanctions. This
auto-authorization happens instantly; the incident never pauses waiting for
a person, by design.

## Where the sign-off call plugs in

`backend/agents/signoff_call.py` in GovOS is this exact pattern — same
safe-by-default dry-run behavior, same `create_and_wait` call shape — wired
specifically to the DDMA tier, since that's the one chaired by a specific
named accountable person (the Chief Minister). `backend/main.py` fires it as
a background task the moment a DDMA-tier approval is created, and when the
call resolves to `confirm` or `override`, it calls
`incident_engine.resolve_approval(incident, approval_id, approve, actor)` —
the identical function GovOS's own dashboard "Override" button already
calls. The phone call is not a separate decision-application path; it's
another caller of the one that already existed.

## A real captured run

With no `CALLE_API_KEY` configured (the default state for local
development), triggering a fire incident in GovOS that auto-authorizes a
DDMA-tier action produces this log line, unmodified:

```
INFO:govos.signoff_call:[DRY RUN — CALLE_API_KEY not set] Would call Chief Minister,
Government of NCT of Delhi to sign off: You are calling Chief Minister, Government
of NCT of Delhi on behalf of an autonomous incident-response system. Speak clearly
and briefly. Explain: the incident "Fire Response — Hauz Khas" just had the
following action auto-authorized under City-wide disaster sanction / multi-district
mutual aid (DDMA) for approximately ₹2,500,000: "Deploy Medical/Ambulance Unit to
Hauz Khas (hospital access blocked) + emergency procurement". Ask whether they want
to CONFIRM this decision as it stands, or OVERRIDE (reject) it. Politely end the
call once you have a clear answer. If they are unavailable or the line doesn't
answer, record the outcome as unclear.
INFO:govos:Sign-off call for inc-dcdb0ff0/appr-cbb94397 -> unclear (dry run)
```

The equivalent, provider-agnostic version of this same run using the app in
this repository is in
[`../assets/dry-run-example.txt`](../assets/dry-run-example.txt).
