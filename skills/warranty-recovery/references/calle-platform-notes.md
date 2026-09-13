# CALL-E platform notes

What the CALL-E Developer API guarantees for this workflow, and what it does
not. Everything below was read from the published documentation on
2026-09-01. Anything not verified there is labelled, rather than assumed.

## Verified

**Creating a call.** `POST /v1/calls` with an `Idempotency-Key` header of 1 to
255 characters. Inputs are `task`, optional `recipients`, `result_schema`,
`recipient_result_schema`, `metadata` and `webhook_url`. Reusing a key with an
equivalent request returns the original call; reusing it with a different body
returns `409 idempotency_conflict`.

**Reading a call.** `GET /v1/calls/{call_id}` and
`GET /v1/calls/{call_id}/events`.

**Lifecycle status** is stable: `queued`, `in_progress`, `completed`, `failed`,
`canceled`.

**Structured results.** `result_schema` is validated server-side before a
terminal call is returned. `structured_result` is `null` when CALL-E could not
produce a schema-valid task-level result from the terminal evidence, or when no
schema was supplied.

The documented schema subset is `type` (one of `object`, `string`, `number`,
`integer`, `boolean`, `array`), `properties`, `required`, `enum`, nested
objects, simple `array.items`, `description` and `additionalProperties: false`.
`$ref`, `oneOf`, `anyOf`, `allOf`, recursive schemas, complex format validation
and `additionalProperties: true` are documented as unsupported.

**Nullable fields are not in that subset.** `type` takes a single value, so
`{"type": ["string", "null"]}` is not documented, although several merged
contributions in this repository use it. This workflow does not depend on it:
optional fields are declared as plain strings, kept out of `required`, and the
description tells the model to omit the field when nothing was stated. Local
validation still accepts a null for an optional field, so a provider that
returns one does not fail the whole result.

**Transcripts.** Attempt transcripts appear at
`recipients[].attempts[].transcript_turns`, each turn carrying
`offset_seconds`, `speaker` and `text`, with `speaker` one of `bot`, `user` or
`unknown`. The array is empty when no transcript is available. No other field
name is used for the speaker.

Both labels matter. `user` is what makes a quote attributable to the
counterparty; `bot` is what identifies the read-back a confirmation was
answering. Dropping the agent's turns would leave a bare "correct" attached to
nothing, which is the failure `identifier-confirmation.md` is built around.

**Keypad IVR.** CALL-E added phone keypad IVR support on 2026-08-15, so a
menu-fronted support line is not automatically out of scope.

**Error envelope.** `{"error": {"code", "message", "details"}}` with a stable
`code` enum of twenty-four values including `invalid_phone`,
`idempotency_conflict`, `result_schema_invalid` and `insufficient_balance`.

## Verified constraints, and what this workflow does about them

**`failure_code` is not an enum.** The documentation states it is a nullable
string with no published enum, that the Calls API does not currently guarantee
a distinct no-answer or callee-decline value at call, recipient or attempt
level, and that integrators must not branch retry, reporting or analytics on a
particular string. It also says, in as many words, that if the documented
fields do not establish the distinction, the business outcome should be kept
unresolved.

So this workflow carries `failure_code` as diagnostic context and never reads
it. A failed call becomes `TRANSPORT_FAILED` with `claim_status: UNKNOWN`,
whatever string came back.

**There is no cancel operation.** The documentation states the Calls API does
not expose an operation for clients to cancel a call after it has been created.
The cancellation story is therefore entirely in front of the call: the
authorization gate refuses before anything is sent, and a retry reuses the
original idempotency key rather than dialling again.

**Webhook deliveries are not signed.** Terminal events are `call.completed`,
`call.failed` and `call.result_validation_failed`. Treat a delivery as a hint,
read only the call id from it, and re-read the authoritative record from the
API before storing anything.

## Goal Runs

`POST /v1/goals/{goal_id}/runs` requires an `Idempotency-Key`, accepts only
`phone` and `variables`, and returns a `GoalRun` whose `error.code` is a real
enum: `call_failed`, `no_answer`, `declined`, `timed_out`, `canceled`,
`result_invalid`, `result_unavailable`, `result_failed`. That enum is the one
thing the Calls API does not offer.

Two documented properties decide against it for this workflow, for now:

- **Goal authoring and publication are not Developer API operations.** A Goal
  is authored and published in CALL-E Chat. The prompt, the schema and the
  result shape therefore live in a dashboard rather than in version control,
  and a reviewer reading this repository cannot see what the call actually
  says.
- **A run request may not supply a task, a schema or a RunSpec selector.**
  Attempting to do so returns `schema_override_not_allowed`. The extraction
  contract in `result-contract.md` would have to move into the Goal, which
  means the read-back fields could no longer be changed in a pull request.

The Goal Run error enum remains the better contract. All eight codes are
mapped to explicit transport/terminal/claim triples in the application
(`warrantyops/goal_runs.py`), every row pinned by tests with an UNKNOWN claim
status: a transport code never grounds a business fact. If a published Goal
can carry this extraction schema, the transport layer is the only part of this
workflow that has to change, which is why the provider is an interface rather
than a function.

## Unverified

- Whether a `GoalRun` result exposes transcripts or attempts. Until that is
  known, the read-back binding cannot be assumed to work on the Goal Runs path.
  The question is answerable mechanically: `probe_goal_capability` evaluates
  any GET-returned GoalRun payload against the promotion criteria, and until
  a real payload passes it the Calls API stays primary.
- Whether a model asked to omit an optional field reliably omits it rather than
  returning null. Both are handled, so this is a question about which branch
  gets exercised, not a risk to the result.
