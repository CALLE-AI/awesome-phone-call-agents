# CALL-E contract verification

Checked 2026-09-08 UTC against the official REST documentation and public
[OpenAPI 0.7.0](https://docs.heycall-e.com/api-reference/0.7.0/calle-openapi.yaml).
The downloaded schema's SHA-256 is
`1cc4d17dfc5db3f4e048cde6bdcd0936326fb032b0592a0ecd67f299614f543e`.
This is an API contract review with synthetic tests, not a successful live call.

- [Calls API reference](https://docs.heycall-e.com/api-reference/calls)
- [Lifecycle and transcript schemas](https://docs.heycall-e.com/api-reference/~schemas)
- [Structured results and call semantics](https://docs.heycall-e.com/calls)
- [REST authentication](https://docs.heycall-e.com/authentication)

## Request and result boundaries

The REST path is `POST https://api.heycall-e.com/v1/calls`, with Bearer
authorization, a stable `Idempotency-Key`, a task, one recipient's
phones/region/locale, task and recipient result schemas, and metadata.
The returned top-level `id` is the call task identifier for
`GET /v1/calls/{call_id}`. Nested attempt `provider_call_id` values identify
Dashboard Call Records and must not replace the top-level ID. Creation also
retains legacy `call_id` support, rejecting unsafe or conflicting IDs.

The documented extraction profile supports scalar JSON types and a limited
set of keywords. Both request schemas use integer `capacity_portions`, with
zero representing no confirmed capacity alongside `willing: no` or `unknown`.
The task wording uses the same convention. The local interpreter independently
requires an integer greater than zero and no greater than the offered quantity
before producing a candidate. It never treats a schema-valid result as proof
of willingness. The previous nullable type union and numeric constraint
keywords were outside the listed extraction profile; no server rejection of
that earlier request was observed or claimed.

## Lifecycle and evidence

The REST statuses are `queued`, `in_progress`, `completed`, `failed` and
`canceled`. `task_completed` may be null, including while a call is pending.
Null is preserved and never coerced into success. Pending results can be polled
within the configured bound; exhausting the read budget is neither a call
failure nor cancellation. Unknown future statuses also remain held, with
bounded monitoring rather than a guessed terminal meaning.

All three documented terminal statuses stop polling and are durably cached.
Failed and canceled results have `monitoring: terminal_hold`; they cannot
produce confirmed capacity or trigger a second creation. Failure diagnostics
are preserved verbatim, without mapping unpublished failure codes to recipient
refusal, retry advice or business outcomes. Old cached failed/canceled results
labelled pending are reclassified locally without another GET or a refreshed
retrieval timestamp. This annotation update invalidates an older exported
envelope, so use the newly returned envelope for any private inspection.

`completed` is a lifecycle state, not consent to receive food. Even
`task_completed: true` only permits further checks. Positive extraction needs
one recipient, one attempt, the exact expected fields, and a supporting quote
in a `user` transcript turn. Documented `unknown` turns are retained for human
inspection but never count as recipient evidence; a separate valid user quote
can still be considered. Bot text, unknown-only quotes, multiple attempts,
malformed turns and nonaffirmative willingness cannot confirm capacity.

The parser checks the fields used for attribution and decisions; it is not a
complete validator for every OpenAPI field. Older minimal fixtures remain
explicitly synthetic. Unexpected wrappers, mismatched IDs and invalid decision
types are not guessed into success. No client cancellation endpoint is
documented or implemented. Stop creating new work and reconcile in the
dashboard; do not delete the ledger or redial after uncertainty.

## Verified locally

103 Python tests pass, including 18 REST contract regressions. Full synthetic
responses cover queued null → in-progress null → completed → exact human review
→ snapshot reconciliation. Tests also cover immutable failed/canceled holds,
diagnostics, concurrent reads, legacy cache labels, unknown speakers and local
quantity bounds. The urllib adapter's origin, methods, headers, no-redirect
behavior, JSON handling and response size bound use a fake HTTP transport.

Seven actual local browser checks pass: computation/download, immediate edit
invalidation, JSON errors, HTTP validation failures, network failures and
responses arriving after edits or reset. Browser verification records are retained with the source project; this
contribution excludes local evidence outputs. This browser exercise does not
use CALL-E.

A human must inspect actual dashboard evidence, identity, meaning, capacity and
the real confirmation time. Approval binds the exact saved provider read,
original request and planning snapshot. Live review and reconciliation use the
current system clock, including after time spent reviewing; there is no CLI
clock override. The SQLite record is unencrypted and is not a provider signature.

## Remaining live gate

No CALL-E credential, authenticated API request or real call was used for these
checks. REST requires a dashboard project API key in `CALLE_API_KEY`; a CLI/MCP
OAuth sign-in does not configure this REST adapter. The operator must verify
actual account access and a no-new-charge allowance, then obtain specific
recipient/call approval before creation. Preserve the call ID after any error.
Run read mode, inspect the actual response and retain private evidence and
source references for an honest demonstration. Passing tests, registration,
a fixture or a contribution PR is not a working live-call demonstration or a
final contest submission.
