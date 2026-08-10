# Fail-closed dispositions

The Callback Coordinator deliberately routes to a human whenever the outcome is
anything other than a confidently classified, consented callback. The guiding
principle: **uncertainty is never read as success**, and a phone call that does
not reach a clear, consented answer is not auto-closed.

## Disposition matrix

| Disposition | Condition (all must hold) | Routing |
|---|---|---|
| `scheduled` | `right_person = yes`, `consent = yes`, reason ∈ actionable set, confidence ≥ 0.7 (or label `high`), not urgent | Matched team |
| `declined` | consent `no`, or reason `declined` | Closed (no callback wanted) |
| `skipped` | Gate blocked the call (quiet hours or `do_not_call`) | No call made |
| `needs_human` | Anything else | Human review |

## What lands in `needs_human`

Each case below routes to a human instead of a success branch:

- **Missing result** — CALL-E returned no `structured_result`.
- **Call failed or canceled** — terminal status `failed` or `canceled`.
- **Wrong person** — `right_person = no`.
- **Right person unconfirmed** — `right_person = unknown` or not `yes`.
- **Consent unconfirmed** — `consent_after_ai_disclosure != yes`.
- **Reason ambiguous** — `contact_reason` is `unknown`, `other`, or not a
  recognized category.
- **Low confidence** — completion confidence below threshold.
- **Urgent matter** — `urgent = yes`: fast-tracked to a human, not auto-routed.
- **Create/result error** — the create response had no call id, the lookup
  timed out or raised, or the outcome of `POST /v1/calls` was indeterminate.

For `needs_human`, the engine keeps the matched team when the reason is still
confident enough to target a specialist (e.g. low confidence but clear
`billing` → the Billing team reviews). Otherwise it falls back to
"General Intake (human review)".

## Idempotency and reconciliation

- The create request uses a stable `callback-triage-<workflow_id>` idempotency
  key, so replaying the same intake after an ambiguous create cannot create a
  duplicate outbound call.
- If `POST /v1/calls` succeeds but the response lacks a recognized id, or the
  outcome is indeterminate, the ticket reports `needs_human` with
  `reason = create_no_id` / `result_lookup_error` and preserves the idempotency
  key for provider-side reconciliation. Do not retry that request with a new
  key.

## Boundaries

This engine does not auto-take any real-world action other than routing a
callback ticket. It never books, cancels, purchases, or modifies a service, and
it never sends the extracted reason anywhere on its own — the routing decision
is returned to the caller, which is responsible for any downstream human action.
