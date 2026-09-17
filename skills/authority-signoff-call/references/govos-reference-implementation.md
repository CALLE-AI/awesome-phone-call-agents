# Reference implementation: GovOS

[GovOS](https://github.com/shubhangi-mish/agents-for-humans/tree/main/govos)
is a Strands Agents-based autonomous incident-response **simulation** for
Delhi (built for a separate hackathon) — an experimental administrative
demo, not a deployed government system, exactly as its own call scripts say
below ("a government-operations simulation app," "simulated scenario").
It's included here as a real, tested use of this exact pattern against
CALL-E's live API rather than a hypothetical description.

## Where it's authorized

GovOS runs several Strands agents (Intel, Resource, Policy, Comms,
Orchestrator) that read a real-world incident signal (real Delhi news
headlines) and simulate the response inside the app — recording a
simulated dispatch and auto-authorizing simulated actions that exceed
field-level scope, modeled on real delegated-authority tiers: a District
Magistrate tier for routine emergency spend, a Police Commissioner tier for
law-and-order actions, and a DDMA (Delhi Disaster Management Authority —
chaired by the Chief Minister) tier for city-wide or high-value sanctions.
No real unit is actually dispatched and no real money moves; the tiers and
their names are real, the actions taken under them in GovOS are not. This
auto-authorization happens instantly; the incident never pauses waiting for
a person, by design.

## Where the sign-off call plugs in

`backend/agents/signoff_call.py` in GovOS is this exact pattern — same
safe-by-default dry-run behavior, same `create_and_wait` call shape.
`backend/main.py` fires it as a background task the moment *any*
authority-tiered approval is created (District Magistrate, Police
Commissioner, or DDMA — it was initially wired to DDMA only, then widened
once real usage showed a reviewer expects a call whenever a decision needed
sign-off, not only the highest tier), and when the call resolves to
`confirm` or `override`, it calls
`incident_engine.resolve_approval(incident, approval_id, approve, actor)` —
the identical function GovOS's own dashboard "Override" button already
calls. The phone call is not a separate decision-application path; it's
another caller of the one that already existed.

## A real captured dry run

With no `CALLE_API_KEY` configured (the default state for local
development), calling GovOS's own `_build_task()` for a DDMA-tier
auto-authorization produces this call script, unmodified (captured directly
from the running function, not retyped):

```
This is a routine administrative call about a software demo/simulation. It is
NOT a real emergency, is not connected to any real emergency dispatch, and
does not direct or affect any real-world incident response — say this plainly
if asked. The purpose of this call is to get Chief Minister, Government of
NCT of Delhi's approval on one matter: a government-operations simulation
app's policy engine provisionally recorded the following as authorized under
City-wide disaster sanction / multi-district mutual aid (DDMA) for
approximately ₹2,500,000, pending their review: "Deploy Medical/Ambulance
Unit to Hauz Khas (hospital access blocked) + emergency procurement"
(simulated scenario: "Fire Response — Hauz Khas"). Speak clearly and briefly,
state up front that you're calling to get their approval on this matter, then
ask whether they CONFIRM (approve) it as recorded, or OVERRIDE (reject) it —
flag a rejection for correction in the app. Politely end the call once you
have a clear answer. If they are unavailable or the line doesn't answer,
record the outcome as unclear.
```

The equivalent, provider-agnostic version of this same run using the app in
this repository is in
[`../assets/dry-run-example.txt`](../assets/dry-run-example.txt).

## A second real trigger for the same pattern: tag-notification calls

The same accountable-person-reached-by-phone pattern this skill packages
turned out to generalize to a second trigger in GovOS, not just auto-
authorization: when one authority tags another office on a shared comment
thread and needs an urgent reply, `backend/main.py` places the same kind of
call — same safe-by-default gating, same single pre-registered number, same
"say plainly this isn't a real emergency" framing — but asking for an
acknowledgement and a short reply instead of a confirm/override. Captured
directly from `_build_tag_task()`:

```
This is a routine administrative call about a comment left on a software
demo/simulation record. It is NOT a real emergency and does not direct or
affect any real-world action — say this plainly if asked. You are reaching
the line registered for MCD Zone Office. Chief Minister, Government of NCT
of Delhi tagged this office on a simulation record titled "Fire Response —
Hauz Khas" and is requesting an urgent reply. Their comment: "Please confirm
the ambulance unit reached the site.". Speak clearly and briefly: read the
comment, ask if they can acknowledge it and give a short reply. Politely end
the call once you have an answer. If they are unavailable or the line
doesn't answer, record acknowledged as false.
```

This isn't part of the packaged skill's API (`request_signoff_call` still
only returns `confirm`/`override`/`unclear`) — it's evidence that the
underlying pattern (one real call, to one pre-consented number, framed
plainly as non-emergency, with a structured result and a safe-by-default
gate) is reusable beyond the single "post-hoc sign-off" use case this skill
names.

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
works end to end against CALL-E's real, live API — not a sandbox, and not
just in dry run. It is evidence about the *integration*, not a claim that
GovOS itself is deployed government infrastructure — it is a hackathon
simulation, and its own call scripts say so explicitly.
