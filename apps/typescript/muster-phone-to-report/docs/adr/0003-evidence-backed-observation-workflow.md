# ADR 0003: Evidence-backed observation workflow

- Status: Accepted
- Date: 2026-08-06

## Context

An observation operation crosses authorized HTTP or scheduled ingress, PostgreSQL idempotency,
pg-boss delivery, a provider-neutral call boundary, immutable evidence retention, deterministic
reconciliation, and a generated-client status read. A provider or evidence failure still needs a
durable terminal result, but it must not fabricate an observation or translate unknown evidence
into normal state. Reviewed fixtures remain `SIMULATED`; they are repository evidence only and do
not prove CALL-E, Sensaphone, provider, or device behavior.

## Decision

Use `CallAttempt.id` as the durable operation identity exposed at
`/api/v1/observations/{operationId}`. Manual and scheduled ingress call the same
`RequestObservation` intention. PostgreSQL establishes the organization-scoped semantic identity
before queue admission; pg-boss uniqueness is a delivery hint, and replay/recovery uses the stored
operation and provider-dispatch identity.

Provider lifecycle facts are retained before interpretation. `EvidenceRecord` revisions and
derived `Observation` versions append immutable lineage. Every `Reading` points to its exact
evidence, provider run/revision, adapter, extractor, source anchor, and timestamps. Expected zones
are reconciled explicitly, and only the complete grounded inventory can produce `complete`.
Missing, ambiguous, contradictory, truncated, null, or unavailable evidence remains fail-closed.

The REST projection keeps attempt state, opaque evidence metadata, and derived observation fields
separate. `observation: null` is the required representation for blocked, no-answer, busy,
provider-failed, and evidence-unavailable terminal operations. `SIMULATED` remains a typed
provenance value throughout the attempt/evidence/observation lineage.

Polling remains server-guided. `OBSERVATION_RETRY_AFTER_SECONDS` configures a validated integer
from 1 through 60, with 2 as a local/test default. This value is bounded client guidance, not a
production SLO. A polling timeout does not cancel durable work or authorize a second call.

Concrete PostgreSQL, pg-boss, observability, HTTP, policy, and provider bindings remain in
composition roots. No production provider is registered by this decision. W3C trace context is
carried through HTTP/job/provider seams; logs and metric attributes use closed, redacted fields and
never carry organization, endpoint, provider, or evidence identifiers.

## Consequences

Generated-client consumers receive one stable operation resource across retry, worker restart,
and terminal failure. Corrections add evidence and observation versions without rewriting history.
Database constraints, OpenAPI generation, architecture policy, and migration drift each have an
independent disposable mutation oracle.

The later `fleet-health-operations-view` must display last attempt separately from last complete
observation, compute freshness from explicit timestamps and policy, retain visible `SIMULATED`
provenance, and never map null, partial, unknown, or invalid evidence to normal. Endpoint discovery,
manual UI controls, notifications, incidents, escalation, and production cadence remain separate
features.

## Rejected alternatives

- Holding POST open until provider work completes.
- Creating a mutable placeholder Observation for every attempt.
- Treating queue uniqueness as the idempotency authority.
- Using simulator fixtures as provider/device certification.
- Hardcoding an example polling interval as a production latency target.
