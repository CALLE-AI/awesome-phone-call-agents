# Fail-closed dispositions
The Callback Coordinator deliberately routes to a human whenever the outcome is
anything other than a confidently classified, consented callback. The guiding
principle: **uncertainty is never read as success**, and a phone call that does
not reach a clear, consented answer is not auto-closed.
## Disposition matrix
| Disposition | Condition (all must hold) | Routing |
|---|---|---|
| `scheduled` | **Binding bound**: `id` matches created call, `metadata.workflow_id` matches intake, `recipients[].phones` contains intake phone; plus `status=completed`, `task_completed=true`, `right_person=yes`, `consent=yes`, reason ∈ actionable set, confidence ≥ 0.7 (or label `high`), not urgent, all enums bound | Matched team |
| `declined` | consent `no`, or reason `declined` (with completed true) | Closed (no callback wanted) |
| `skipped` | Gate blocked the call (quiet hours, `do_not_call`, or `consent_not_recorded`) | No call made |
| `needs_human` | Anything else – including binding mismatches, non-completed status, task_completed=false, unbound enum values | Human review |
## What lands in `needs_human`
Each case below routes to a human instead of a success branch:
- **Missing terminal result** – CALL-E returned no dict.
- **Binding mismatch** – terminal result not bound to approved session:
  - `id` present and != expected call id → `binding_call_id_mismatch`
  - `metadata` missing or `workflow_id` != intake → `binding_metadata_missing` / `binding_workflow_id_mismatch`
  - `workflow_type` present and != `callback_triage` → `binding_workflow_type_mismatch`
  - `recipients` missing or intake phone not in `recipients[].phones` → `binding_recipients_missing` / `binding_recipient_phone_mismatch`
  - Prevents a completed payload for a different workflow or phone from being accepted as `scheduled`.
- **Not completed** – `status` is not exactly `completed` (e.g. `in_progress`, `failed`, `canceled`) or missing. `failed`/`canceled` map to `call_failed`/`call_canceled`, others to `call_not_completed_status_*`.
- **Task not completed** – `task_completed != true` → `task_not_completed`.
- **Missing structured result** – no `structured_result`.
- **Invalid / unbound structured data** – any `structured_result` field outside its declared enum (`right_person`, `consent_after_ai_disclosure`, `contact_reason`, `urgent`, `voicemail_allowed`) → `invalid_*`. This prevents arbitrary LLM output from being classified as success.
- **Wrong person** — `right_person = no`.
- **Right person unconfirmed** — `right_person = unknown` or not `yes`.
- **Consent unconfirmed** — `consent_after_ai_disclosure != yes`.
- **Reason ambiguous** — `contact_reason` is `unknown`, `other`, or not a recognized category.
- **Low confidence** — completion confidence below threshold.
- **Urgent matter** — `urgent = yes`: fast-tracked to a human, not auto-routed.
- **Create/result error** — the create response had no call id, the lookup timed out or raised, or the outcome of `POST /v1/calls` was indeterminate.
For `needs_human`, the engine keeps the matched team when the reason is still
confident enough to target a specialist (e.g. low confidence but clear
`billing` → the Billing team reviews). Otherwise it falls back to
"General Intake (human review)".
## Why the task no longer offers a callback time
The earlier prompt offered "book a specific callback time now" but the result
schema has no time field. That mismatch meant a promised time could be lost or
hallucinated. The fixed prompt explicitly says: do **not** attempt to book a
time; it only triages why the callback is needed and whether voicemail is okay.
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
