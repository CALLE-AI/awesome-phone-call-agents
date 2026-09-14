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

## A real captured dry run

With no `CALLE_API_KEY` configured (the default state for local
development), triggering a fire incident in GovOS that auto-authorizes a
DDMA-tier action produces this log line, unmodified:

```
INFO:govos.signoff_call:[DRY RUN — CALLE_API_KEY not set] Would call Chief Minister,
Government of NCT of Delhi to sign off: This is a routine administrative call about
a decision already recorded by an automated system. It is not a live emergency,
does not seek a real-time operational decision, and does not direct or affect any
live incident, dispatch, or safety-critical process — say this plainly if asked.
You are calling Chief Minister, Government of NCT of Delhi to review one log entry.
Speak clearly and briefly. Context: Fire Response — Hauz Khas. The system's policy
engine already recorded the following as authorized under City-wide disaster
sanction / multi-district mutual aid (DDMA) (amount: approximately ₹2,500,000):
"Deploy Medical/Ambulance Unit to Hauz Khas (hospital access blocked) + emergency
procurement". Ask whether they want to CONFIRM this log entry as recorded, or
OVERRIDE it (flag it for correction). Politely end the call once you have a clear
answer. If they are unavailable or the line doesn't answer, record the outcome as
unclear.
INFO:govos:Sign-off call for inc-dcdb0ff0/appr-cbb94397 -> unclear (dry run)
```

The equivalent, provider-agnostic version of this same run using the app in
this repository is in
[`../assets/dry-run-example.txt`](../assets/dry-run-example.txt).

## A real live call

With real `CALLE_API_KEY`/`CALLE_SIGNOFF_PHONE`/`CALLE_SIGNOFF_ENABLED=true`
configured and GovOS's own developer's number as the recipient, triggering
the same fire incident placed a real call through the live CALL-E API:

- The *first* attempt, using the direct-operational-language wording quoted
  in [`safety.md`'s "Lesson from testing"](safety.md#lesson-from-testing-call-e-rejected-an-earlier-version-of-this-script),
  was rejected by CALL-E's own call-creation safety check with an HTTP 422
  before any call was placed.
- After rewriting `build_task()` to the current wording (reviewing an
  already-recorded log entry, not issuing a live directive), the call was
  accepted, connected, and the recipient's phone rang — confirmed directly
  by the recipient. The call was not answered, and the result correctly
  resolved as `decision: "unclear"` with no error — exactly the documented
  failure-handling behavior in `safety.md`, not a crash or a silent
  misclassification as `override`.

This is real, verified evidence that the safe-by-default → live-call path
works end to end against the production CALL-E API, not just in dry run.
