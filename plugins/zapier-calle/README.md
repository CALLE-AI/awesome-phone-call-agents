# Zapier CALL-E integration

A Zapier Platform CLI integration that places outbound CALL-E phone calls from
a Zap and reports back a fail-closed disposition, transcript, summary, and
any structured result the call extracted.

## Install it

This integration is published to Zapier as a **private** integration, not
listed in Zapier's public app directory, so the invite link below is how
you get access:

https://zapier.com/developer/public-invite/244591/5987695714e8692147ff45fdcb3be684/

Installing it requires a CALL-E API key, entered when you connect the
account inside Zapier - see [Setup](#7-setup) for what the key needs.

The quickest way to confirm it works end to end is
[`examples/two-step-free-plan.md`](examples/two-step-free-plan.md): a
two-step recipe that runs on Zapier's free plan and needs no third-party
app connection beyond the CALL-E account itself.

**Leave `Dry Run` set to `true` for the first run.** It returns a masked
preview and places no call. Only turn it off deliberately, as its own
step, and only with a phone number you are authorized to call.

Building from source is not required to try it. The source lives in this
directory; `npm install && npm test` runs the full suite with no
credentials required.

## 1. What it does

The integration places a phone call through the CALL-E Developer API, then
either waits inside the Zap for the call to finish or returns immediately so
a later step can look the result up. Every terminal outcome is classified
into one of seven dispositions (see [Dispositions](#5-dispositions)) so a
downstream step can branch on `is_actionable` instead of parsing free-text
status strings.

Two ways to wire it into a Zap:

- **One-Zap shape.** Use `Place Call and Wait for Outcome`. The single Zap
  run places the call, waits for CALL-E to report a terminal outcome (or up
  to 30 days, whichever comes first), and continues with the disposition and
  result already attached. Simplest option when the rest of the Zap only
  needs to react to the outcome.
- **Two-Zap shape.** Zap 1 uses `Start Call (No Wait)` and returns
  immediately with a `call_id`. A separate Zap (for example, on a Schedule by
  Zapier trigger) later calls `Find Call Result` with that `call_id` to
  reconcile the outcome. Use this when the call and the reconciliation logic
  belong in different Zaps, or when a single long-waiting step is not a good
  fit for the rest of the workflow.

## 2. Why the callback pattern

The CALL-E Developer API has no endpoint that lists calls, so a polling
trigger is not possible - there is nothing for Zapier to poll. Zapier create
actions must also return in roughly 30 seconds, which is far shorter than a
phone call takes to resolve.

`Place Call and Wait for Outcome` works around both limits with the Zapier
Platform CLI's callback pattern: `perform` calls `z.generateCallbackUrl()` to
mint a one-time webhook URL, sends it to CALL-E as `webhook_url`, and returns
immediately. The Zap step then holds open for up to 30 days. When CALL-E
posts the terminal event to that URL, the Zapier platform invokes this
integration's `performResume` with the callback body and the output from the
original `perform` call, and `performResume` produces the final result.

`z.generateCallbackUrl()` and `performResume` are a Zapier Platform CLI
feature - they are not available to integrations built with the legacy
Zapier web app editor, which is why this integration ships as a CLI app
rather than a set of visual-builder actions.

## 3. Actions and search

| Name | Type | Key inputs |
| --- | --- | --- |
| `Place Call and Wait for Outcome` | Create | Call Task, Recipient Phone Number, Region (optional), Locale (optional), Result Schema (optional), Correlation ID (optional), Dry Run |
| `Start Call (No Wait)` | Create | Same inputs as above |
| `Find Call Result` | Search | Call ID |

All input fields for the two create actions:

| Field | Required | Notes |
| --- | --- | --- |
| `task` (Call Task) | Yes | What CALL-E should accomplish on the call. |
| `phone` (Recipient Phone Number) | Yes | Must be E.164, for example `+15550123456`. |
| `region` (Region) | No | Optional ISO country code. Never inferred from the number. |
| `locale` (Locale) | No | Optional locale such as `en-US`. Never inferred from the number. |

**Region and language:** CALL-E may reject a call task with HTTP 422
`call_not_ready` and a clarifying question when the destination region
implies a language requirement (observed live for a Vietnamese number).
Setting `Region` and `Locale` explicitly avoids this. The integration never
infers either from the phone number.
| `result_schema` (Result Schema (JSON)) | No | JSON Schema for the structured result. See the allowlist in [Result schema support](#result-schema-support). |
| `correlation_id` (Correlation ID) | No | Your own record id, echoed back on the result as `correlation_id`. |
| `dry_run` (Dry Run) | No | Defaults to `false`. See [Dry run](#8-dry-run). |

`Find Call Result` takes a single required `Call ID` input - the `call_id`
returned by either create action - and returns the same output shape as the
create actions.

**Not-found behavior:** when the supplied Call ID does not exist, CALL-E
returns HTTP 404 and the integration raises an error reading `CALL-E request
failed with status 404. Call not found.` It does not return an empty result
set. This is a deliberate deviation from the usual Zapier search convention
of returning no results when nothing is found. This search exists to
reconcile a call that may already have happened, and silently returning
nothing for a mistyped or stale Call ID would let a workflow conclude that
no call took place - the same failure mode the rest of this integration is
built to prevent. An error is louder and safer than a false negative.
Supply a Call ID captured from `Start Call (No Wait)` or from a
`Place Call and Wait for Outcome` step, rather than a hand-typed value.

### Result schema support

`result_schema` is validated against an allowlist, not a blacklist. Only
these JSON Schema keywords are accepted: `type`, `properties`, `required`,
`enum`, `items`, `description`, and `additionalProperties` (which must be
exactly `false`). Anything else - `patternProperties`, `dependentSchemas`,
`if`/`then`/`else`, `not`, `const`, `format`, `$ref`, `$defs`, `oneOf`,
`anyOf`, `allOf` - is rejected with a validation error rather than silently
ignored. Nesting is capped at 20 levels, so a schema built from a cyclic
object reference produces a validation error instead of hanging or
overflowing the stack.

## 4. Outputs

Every action returns this shape. `structured_result` fields are also
flattened onto the top level with a `result_` prefix (for example, a
structured result field named `acknowledged` also appears as
`result_acknowledged`) so they can be mapped individually into later Zap
steps.

| Field | Description |
| --- | --- |
| `disposition` | One of the seven values in [Dispositions](#5-dispositions). |
| `disposition_reason` | Human-readable reason the disposition was chosen. |
| `is_actionable` | `true` only when `disposition` is `confirmed`. |
| `event_id` | The CALL-E webhook event id, when available. |
| `event_type` | The CALL-E webhook event type, when available. |
| `call_id` | The CALL-E call id. |
| `status` | The CALL-E call status (see [Status vocabulary](#6-status-vocabulary-note)). |
| `task_completed` | Whether CALL-E considered the task completed. |
| `confidence_label` | CALL-E's completion-confidence label, or `null`. |
| `confidence_score` | CALL-E's completion-confidence score, or `null`. |
| `summary` | CALL-E's call summary, or `null`. |
| `evidence` | Supporting evidence array from CALL-E, or `[]`. |
| `failure_code` | Failure code when the call failed, or `null`. |
| `failure_message` | Failure message when the call failed, or `null`. |
| `correlation_id` | The correlation id you supplied, echoed back, or `null`. |
| `completed_at` | Completion timestamp, or `null`. |
| `recipients_total` | Number of recipients on the call. |
| `recipients_completed` | Number of recipients whose status is `completed`. |
| `recipients_failed` | Number of recipients whose status is `failed`. |
| `transcript_text` | Full transcript, turns joined as `speaker: text` lines. |
| `structured_result` | The raw structured result object, or `null`. |
| `recipients` | The raw per-recipient array from CALL-E. |
| `result_*` | Each key of `structured_result`, flattened to the top level. |

`Start Call (No Wait)` additionally returns `dry_run` and
`idempotency_key`; `Place Call and Wait for Outcome` returns a `preview`
field instead of a `call_id` when run as a dry run.

Phone numbers are masked in every output and error message before they leave
the integration.

## 5. Dispositions

| Disposition | `is_actionable` | When it applies |
| --- | --- | --- |
| `confirmed` | `true` | Call completed, `task_completed` was `true`, confidence label was `high`, and a non-empty structured result was extracted. |
| `review_required` | `false` | Call completed but `task_completed` was not `true`, confidence label was not `high`, or the structured result was missing or empty. |
| `result_invalid` | `false` | CALL-E could not validate the structured result against the supplied `result_schema`. |
| `failed` | `false` | The call failed (status `failed` or a `call.failed` event). |
| `canceled` | `false` | The call was canceled before completion. |
| `outcome_unknown` | `false` | The call is still `queued` or `in_progress`, or the webhook payload itself was unreadable. Deliberately distinct from `failed` - treating an ambiguous result as a failure is how a workflow ends up dialing someone twice. |
| `needs_human` | `false` | Default, fail-closed branch: a malformed event, an unrecognized event type, a missing or unrecognized call status, or a callback that fails id verification (see [Callback verification](#callback-verification)). |

Only `confirmed` sets `is_actionable` to `true`. An unrecognized status or
event type is never treated as a success - it always resolves to
`needs_human`.

### Callback verification

A Zapier callback URL is unauthenticated: anything that discovers the URL
could post to it. Before `performResume` accepts a callback as the result of
the call this step started, it checks that the call id the step recorded
when it placed the call, and the call id carried in the callback body, are
both present and equal. If the id this step started is unknown, if the
callback carries no id, or if the two ids differ, `performResume` returns
`needs_human` rather than trusting the callback body. This check is the
reason a resumed payload can be trusted.

## 6. Status vocabulary note

This integration consumes the CALL-E **Developer API**, whose `status`
field uses five lowercase values: `queued`, `in_progress`, `completed`,
`failed`, `canceled`. The CALL-E **CLI and MCP surface** documented
elsewhere in this repository uses a different, uppercase vocabulary that
includes values such as `NO_ANSWER` and `VOICEMAIL`. The two vocabularies do
not map one-to-one. If you build a status mapping by reading the CLI
reference first, it will not match what this integration (or the Developer
API) actually returns.

## 7. Setup

1. In Zapier, create a connection for this integration and enter your CALL-E
   API key. The key is stored as a password-typed field and is sent only as
   an `Authorization: Bearer` header.
2. CALL-E places real phone calls. Only connect an API key and supply phone
   numbers you are authorized to call.
3. Add `Place Call and Wait for Outcome`, `Start Call (No Wait)`, or
   `Find Call Result` to a Zap and map in the Call Task and Recipient Phone
   Number.

## 8. Dry run

Set Dry Run to `true` to preview a call without placing one. A dry run never
calls `z.generateCallbackUrl()` and sends no request to CALL-E - it returns a
masked preview of the endpoint, idempotency key, and payload instead.

Only an explicit negative places a real call: `false`, `'false'` in any
letter case, `0`, `'0'`, an empty or whitespace-only string, `null`, or
`undefined`. Every other value - including `true`, any other string, a
number other than `0`, or any unrecognized input - is treated as a dry run.
This is deliberate: an integration that cannot confidently tell a value
means "no" refuses to place the call rather than guess.

Example dry-run preview payload uses `+15550123456` as the recipient number.

## 9. Side effects and cancellation

- With Dry Run `false`, each Zap run of `Place Call and Wait for Outcome` or
  `Start Call (No Wait)` places exactly one outbound phone call.
- To stop future calls, turn the Zap off. A call that has already been
  placed cannot be recalled.
- If a `Place Call and Wait for Outcome` step is interrupted, or a webhook
  from CALL-E is missed, use `Find Call Result` with the recorded `call_id`
  to reconcile the outcome afterward.
- This integration derives a stable `Idempotency-Key` for each call: a
  SHA-256 digest of the task, recipients, result schema, recipient result
  schema, and metadata, computed before the per-run `webhook_url` is
  attached so the key stays constant across retries of the same logical
  call. Per CALL-E's documented `Idempotency-Key` contract, reusing the
  same key with the same request returns the original call instead of
  creating a duplicate. A changed payload - a different phone number, task
  text, or schema - produces a different key and is therefore correctly
  treated as a new call. This project has not exercised that behavior
  against a live CALL-E instance.

## 10. Testing

`npm install && npm test` runs 121 tests across 13 files against a bundled
fake CALL-E server. No credentials are required and no real calls are
placed. `test/e2e-app.test.js` additionally drives the real app definition
(`index.js`) through `zapier-platform-core`'s `createAppTester`, exercising
the actual `beforeRequest`/`afterResponse` middleware chain rather than
calling `operation.perform` in isolation.

**Known limitation:** under `createAppTester`, `z.generateCallbackUrl()`
returns a fixed Zapier-hosted URL rather than one that routes back to the
fake server, so the automated tests cannot drive an actual HTTP delivery of
the CALL-E webhook to that URL. The tests do verify that `perform` requests a
callback URL and sends it to CALL-E as `webhook_url`, and that `performResume`
runs correctly through the real platform once it receives a callback body -
just not the live HTTP delivery leg in between.

**Live verification:** performed 2026-08-02 against `https://api.heycall-e.com`
with `zapier-platform-core` 19.1.0. Three real outbound calls were placed to a
phone number the tester owns. The number itself is not recorded here.

Preflight, no calls consumed:

- Authentication: `GET /v1/goals` returned HTTP 200.
- Dry run with real credentials pointed at the production base URL: zero
  network requests issued, zero Zapier callback URLs generated, and the
  recipient number masked in the preview with no raw digits present.
- E.164 validation and masking confirmed against the real number.

Call 1 - recipient declined:

- `POST /v1/calls` returned HTTP 201; the handset rang.
- The recipient hung up without answering. CALL-E retried, then the call
  task reached terminal `status: failed` with `failure_code` reporting
  `DECLINED (Hangup by: user)`.
- CALL-E still returned an extracted `structured_result` of
  `{"heard_clearly": "unknown"}`, but `task_completed` was `false`.
- The integration classified this as `disposition: failed`,
  `is_actionable: false`. It did not treat the presence of a structured
  result as success. No raw digits appeared anywhere in the flattened
  output.

Call 2 - recipient answered:

- `POST /v1/calls` returned HTTP 201. The call rang, connected, CALL-E held
  the conversation in Vietnamese, and the recipient confirmed.
- Terminal `status: completed` was reached about 50 seconds after creation.
- `task_completed: true`, `completion_confidence` `high` at 0.95, and
  `structured_result` of `{"heard_clearly": "yes"}` matching the schema
  supplied on the request.
- Six transcript turns were returned.
- The integration classified this as `disposition: confirmed`,
  `is_actionable: true`. No raw digits appeared anywhere in the flattened
  output.

**Clarification path - no call consumed.** A `POST /v1/calls` for a Vietnamese
number submitted with `Region` set but `Locale` omitted returned HTTP 422
with error code `call_not_ready`, carrying a `details.questions` array.
CALL-E asks before dialing rather than guessing, and spends no call doing
so. Running that real response through the integration's `checkForErrors`
produced the user-facing message:

> CALL-E needs more information before it will place this call
> (clarification requested): For this Vietnam number, the supported call
> language is Vietnamese. Should the call be placed in Vietnamese? Answer
> the question directly in the Call Task text, and set the Region and
> Locale input fields explicitly - this integration never infers them from
> the phone number.

Note that the API key was not present anywhere in that message, confirming
the redaction path holds on a real error response.

**Reconciliation path - no call consumed.** `Find Call Result` was run
against the production API for both previously recorded calls. For the
declined call it returned a single result with `disposition: failed` and
`is_actionable: false`; for the answered call, a single result with
`disposition: confirmed` and `is_actionable: true`. Both matched the
disposition the live callback path produced for the same calls, confirming
that a reconciled call and a live call cannot disagree - they share one
classifier. No raw phone digits appeared in either output.

Call 3 - recipient declined, started without waiting:

- `Start Call (No Wait)` returned immediately with a `call_id`,
  `status: queued`, and `disposition: outcome_unknown` - correct, since this
  action does not wait for the call to finish. The `Idempotency-Key` it sent
  was a 64-character hex digest.
- `Find Call Result` was then polled against that `call_id`. It reported
  `outcome_unknown` while the call was non-terminal, and reached a terminal
  state at about 55 seconds.
- The recipient declined the call, and CALL-E reported the call task as
  `status: completed`, not `failed`.
- The integration classified this as `disposition: review_required`,
  `is_actionable: false`, with the reason "Call completed but no structured
  result was extracted."
- The `correlation_id` supplied on the request round-tripped back through
  CALL-E's `metadata` and was present on the reconciled result.
- No raw phone digits appeared in the output.

**Why this call matters:** a declined call was reported by the platform with
`status: completed`. An integration that branches on `status === 'completed'`
- the obvious and common thing to write - would have treated a call the
recipient refused as a success and let a workflow act on it. This integration
did not, because `completed` alone is not sufficient: it also requires
`task_completed`, a high confidence label, and a structured result that
validates.

**What this demonstrates:** the success path, a real non-success path, the
clarification path, the reconciliation path, and a declined call started
without waiting have all now been exercised against production, and the
integration produced the correct outcome for each. Of the three call
records, Call 3 is now the most important: the platform reported a declined
call as `status: completed`, and the integration still refused to mark it
actionable because `task_completed`, the confidence label, and the
structured result did not clear the bar `confirmed` requires. Call 1 remains
the next most important: CALL-E returned a structured result, and the
integration still refused to mark the call actionable because
`task_completed` was false. The clarification path adds a data point of its
own: CALL-E can reject a call before dialing rather than guessing, this
integration surfaces that as a fail-closed clarification request rather than
a generic failure, and no call is consumed doing so. The reconciliation path
shows that looking a call up after the fact through `Find Call Result`
produces the same disposition the live callback path already produced for
that same call, and doing so consumes no additional call. Between the four
records, all three operations this integration exposes - both create
actions and the search - have now been exercised against production.

**Observed platform behavior worth knowing:**

- A call task's top-level `status` from `GET /v1/calls/{id}` read `queued`
  while the call was in flight, whereas `GET /v1/calls/{id}/events` reported
  the real progression: `call.started`, `call.in_progress`, `Call is
  ringing`, `Call connected`, `Bot is speaking`, `Callee said`, `Call ended`.
  Use the events endpoint when you need live progress; do not infer failure
  from a non-terminal `status`.
- CALL-E retries after a declined call, so a declined call takes materially
  longer to reach a terminal state than an answered one.
- A call task for a Vietnamese number was rejected at creation with HTTP 422
  and error code `call_not_ready`, carrying a `details.questions` array
  asking whether the call should be placed in Vietnamese. Setting `Region`
  and `Locale` explicitly avoids this. This integration surfaces those
  questions rather than reporting a generic failure.

**Not covered by automated tests:** `z.generateCallbackUrl()` under
`createAppTester` targets a fixed Zapier-hosted URL that cannot be
redirected to the local fake server, so the live HTTP delivery leg of the
webhook is exercised only by Zapier itself in production, not by this
repository's test suite.
