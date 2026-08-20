# Outcome Contract

What a consumer of an outcome record is entitled to rely on.

Canonical outcome and result semantics are defined upstream by CALL-E. This
contract describes only what this client-side layer produces.

## Observed states versus reconciled outcomes

Polling observes upstream lifecycle states. Those states belong to CALL-E and
are recorded verbatim. Reconciliation produces exactly one outcome from this
layer's own vocabulary. The two are deliberately separate: an observed state is
what upstream said, an outcome is what this layer is prepared to assert.

## The six outcomes

Exactly one is emitted per reconciliation.

| Outcome | Meaning |
| --- | --- |
| `completed` | Reached an upstream terminal state the mapping table documents as normal completion. |
| `not_connected` | Did not establish media for a documented reason, such as no answer. |
| `declined` | The callee actively declined, and the upstream contract documents the code as such. |
| `infrastructure_failure` | A documented pre-media or transport failure. |
| `cancelled` | The caller cancelled before completion. |
| `unresolved` | Everything else. Carries a machine-readable reason and the last raw payload. |

`infrastructure_failure` is currently unreachable. No published CALL-E code
documents a pre-media or transport failure, which is why such failures are
presently surfaced as callee-declined upstream. The outcome exists so that a
future documented code can be mapped to it by editing the mapping table alone.

## When a call resolves to `unresolved`

* `polling_budget_exhausted` — no terminal state arrived within the budget.
* `undocumented_code` — a terminal value with no documented meaning.
* `undocumented_failure_detail` — a documented failure status whose accompanying
  failure code has no published enumeration.
* `ambiguous_documented_code` — a documented code that does not determine how the
  call ended.
* `result_error_not_call_outcome` — a documented code describing the result
  payload rather than the call.
* `inconsistent_payload` — the payload contradicts itself, for example a
  zero-duration call reported as answered and refused.
* `plan_timeout` — a request timed out with no recoverable state.
* `malformed_payload` — the payload has no usable status field.
* `no_observations` — nothing was observed at all.

`unresolved` is a successful result of this layer, not an error. It means the
question was asked honestly and the public contract does not answer it.

## Record shape

```yaml
schema_version: 1
call_ref: "<upstream identifier, unmodified>"
outcome: unresolved
reason: polling_budget_exhausted
mapping:
  matched: false
  entry_id: null              # e.g. "rest.calls.completed" when matched
  map_version: "2026-08-06"
  surface: rest.calls
timing:
  first_observed_at: "..."
  last_observed_at: "..."
  observation_count: 14
  elapsed_seconds: 900
evidence:
  observed_states: ["rest.calls:queued", "rest.calls:in_progress"]
  notes: ["..."]
  decision: ["..."]           # why this outcome, step by step
raw:
  first_payload: { ... }
  last_payload: { ... }       # verbatim upstream response, all fields
upstream_judgment:
  # CALL-E's own post-call verdict, copied verbatim, or null when it published
  # none. This asserts nothing: `CallStatus.completed` says a call ended
  # normally, not that the caller got what they rang for. A call that reaches
  # voicemail is `completed` with `task_completed: false`, so reporting the
  # outcome alone would be true and still misleading. Read these fields before
  # treating `completed` as success.
  task_completed: false
  completion_confidence: {score: 0.82, label: high}
  summary: "The call reached voicemail..."
  evidence: ["The call reached voicemail instead of a live person."]

recipient:
  phone_e164_masked: "+1555010****"
```

`schema_version` versions this record shape only. It is not a claim about
upstream semantics.

## Guarantees

1. **Termination.** Reconciliation always returns within the configured budget.
   There is no code path that waits indefinitely.
2. **Raw fidelity.** Upstream payloads are embedded verbatim. Nothing is pruned,
   renamed, or normalised, including fields this version does not recognise.
3. **No invention.** Every semantic outcome traces to a documented mapping entry
   by id. An undocumented value is never translated into a semantic outcome.
4. **Idempotence.** The same observations always produce the same record.

Validate a record against this contract:

```bash
node skills/call-outcome-reconciler/scripts/validate-outcome-record.mjs --record out.json
```

## Surfaces

A status value is only meaningful together with the surface it was read from.
The same word carries different vocabularies on different surfaces, so every
observation and every mapping entry is keyed by surface, and matching never
compares an observation to an entry from another surface. See
[`outcome-code-map.md`](outcome-code-map.md) for the surfaces this version knows.

## What this layer does not do

* It does not define canonical result semantics for the ecosystem.
* It does not place, retry, or cancel calls.
* It does not create schedules or recurring jobs.
* It does not infer an outcome from an undocumented code.
* It does not fix upstream defects. It makes their effects legible and
  non-hanging.
