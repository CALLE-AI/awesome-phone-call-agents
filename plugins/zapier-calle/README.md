# Zapier CALL-E integration

Create a single-target Calls v2 request from a Zap, then reconcile its result
with an authenticated lookup. The integration returns a business disposition,
recorded transcript, and the fields requested in your result schema.

## Version and migration

This source prepares **2.0.0**. It has not been published or promoted to existing
Zaps. The [private integration invitation](https://zapier.com/developer/public-invite/244591/5987695714e8692147ff45fdcb3be684/)
is for the previously published integration; it does not establish that this
source version is available there.

New creates use `POST /v2/calls` with one `phone`, a required closed scalar
`result_schema`, and an idempotency key. Authentication still checks
`GET /v1/goals`. See the [CALL-E migration guide](https://docs.heycall-e.com/migration)
and [Calls reference](https://docs.heycall-e.com/api-reference/calls).

Before moving a Zap to this version:

1. Flatten nested schemas and arrays into named scalar fields without dropping
   information your workflow needs. Declare business confirmation and its quote
   explicitly if the Zap is allowed to act automatically.
2. Remap `structured_result` to `result`, failure fields to `error_*`, and read
   the transcript from `transcript_text`. Request `summary` in your schema if
   you need it. `result_*` fields remain available for scalar mapping.
3. Replace confidence-based filters with the business rules below. Calls v2
   supplies no `task_completed`, confidence score, evidence array, recipient
   list, or provider attempt count. This integration does not manufacture them.
   Workflows requiring actual dial counts must resolve that dependency before
   upgrading; the caller-supplied attempt history is not a provider dial ledger.
4. Let accepted v1 work finish on its original integration version and receiver.
   For historical lookups, explicitly select **Calls API Version: v1**.
   Callback handling recognizes `data.object: call_task` for v1 and `call` for
   v2; it never reads a historical ID through the other interface.
5. Validate a separate test Zap before explicitly moving new traffic. Do not
   submit the same task to both APIs or restart an uncertain create with a new
   key. This source change does not switch, activate, or publish any Zap.

## Setup

Connect a CALL-E API key in Zapier's password-typed connection field. Only
supply phone numbers you are authorized to call. **Dry Run starts on:** inspect
the masked request preview before deliberately turning it off.

| Operation | Behavior |
| --- | --- |
| Place Call and Wait for Outcome | Creates a Call with the execution's callback URL, then resumes after a callback and authenticated GET. |
| Start Call (No Wait) | Creates a Call and returns its API ID; use the search to reconcile later. |
| Find Call Result | Reads a known API ID through its original interface. Missing or unreadable records fail the lookup. |
| Call Completed | Static webhook for routing and review; always returns `is_actionable: false`. |

CALL-E has no list-calls or webhook-subscription endpoint. To use the private
static trigger, copy the URL Zapier shows into your CALL-E project's webhook
settings. Keep the legacy receiver for accepted v1 work. The per-execution
callback used by Place Call and Wait is supplied automatically.

The [recipes](examples/README.md) include appointment confirmation, lead
qualification, incident escalation, and a two-step evaluation Zap.

## Inputs

Both create actions share these fields:

| Input | Requirement and meaning |
| --- | --- |
| Call Task | Required instructions, including the intended spoken language and business objective. |
| Recipient Phone Number | Required single E.164 number. |
| Result Schema (JSON) | Required closed flat object; see below. |
| Region / Locale | Optional hints. CALL-E infers omitted hints; this integration does not infer them locally. Conflicts or ambiguity return `input_incomplete`. |
| Correlation ID | Your logical event or record identifier, included in metadata and the idempotency digest. Use a different event ID for an intentionally new call. |
| Dry Run | Defaults to true. Only `false`, `'false'`, `0`, or `'0'` allow a create. Blank or unrecognized values remain previews. |
| Recipient Timezone (IANA) | Enables the calling window; never inferred from the phone or region. |
| Earliest / Latest Local Hour | Defaults to 8 / 21 when the timezone is supplied. The latest hour is exclusive. |
| Block Sunday Calls | Optional local-time guard. |
| Do Not Call List | Optional comma/newline-separated numbers, matched by digits independent of formatting. |
| Previous Attempt Times | Optional comma/newline-separated ISO timestamps from your own records. Enables the retry guard. |
| Max Attempts Per Day / Minimum Hours Between Attempts | Defaults to 2 / 4 when history is supplied. These are configurable workflow limits. |

The history and suppression list are supplied afresh on each run and are not
stored by this integration. Invalid history or an unreadable suppression list
blocks the call. Suppression also blocks a dry run. Calling-window and retry
checks are reported in a dry-run preview rather than blocking the preview.
A blocked create never asks Zapier for a callback URL.

## Result schema support

A schema must declare `type: object`, `properties`, and
`additionalProperties: false`. At most 32 properties are allowed, each a
`string`, `boolean`, `integer`, or `number`. Property descriptions and enums
are supported. Arrays, nested objects, nullable types, schema combinators,
length/range constraints, and patterns are rejected before sending a request.
`required`, when present, must name unique declared properties.

For an incident acknowledgment:

```json
{
  "type": "object",
  "properties": {
    "business_confirmed": {
      "type": "boolean",
      "description": "True only if the recipient explicitly agrees to take this incident now. Otherwise false."
    },
    "business_confirmed_quote": {
      "type": "string",
      "description": "Exact recipient words agreeing to take the incident, or unknown when no such evidence exists."
    },
    "summary": { "type": "string", "description": "Brief factual account of the conversation." }
  },
  "required": ["business_confirmed", "business_confirmed_quote"],
  "additionalProperties": false
}
```

Schemas without these confirmation fields are accepted for collection-only
calls, but their results cannot produce an automatic `confirmed` disposition.
The business criteria belong in your schema descriptions and downstream
checks; a quote match proves the words occurred, not that an arbitrary
business interpretation is correct.

## Outputs and readiness

HTTP 202 means the Call was accepted. Execution `status` is independent of
telephone `call_outcome` and business `result_status`. Keep reading the same
API ID **only while `result_status` is `pending`**, including when execution
is already `completed`. `available` can contain `{}`. `unavailable` may have
both `result` and `error` null. Neither is a reason to redial automatically.
`not_applicable` covers cancellation and technical execution failure.

| Output | Meaning |
| --- | --- |
| `call_id` | The API resource `id`, preserved under this existing Zap mapping name. Use it in Find Call Result and for downstream deduplication. |
| `telephone_call_id` | Nullable telephone/Billing `call_id`; never use it in API paths. It does not establish settled billing. |
| `calls_api` | `v2` for new Calls; `v1` for historical call tasks. |
| `status`, `call_outcome`, `result_status` | Execution, telephone outcome, and result readiness. |
| `result`, `result_*` | Raw business result and each top-level scalar field. |
| `summary` | `result.summary`, if requested and returned; otherwise null. |
| `error_code`, `error_message`, `error_detail_code` | Technical error details; ordinary no-answer, busy, refusal, or missing evidence can have no error. |
| `disposition`, `disposition_reason`, `is_actionable` | The business routing decision and its explanation. |
| `lead_state` | `qualified`, `needs_human`, or `blocked_compliance`; a confirmed business answer is not itself a sales qualification. |
| `verified` | Whether this outcome was read from CALL-E using the connection's key. |
| `transcript_text` | Recorded top-level transcript in order, independent of result availability. |
| `review_excerpt`, `review_excerpt_offset_seconds` | Last recipient turn on results requiring review. |
| `opt_out_requested`, `opt_out_excerpt`, `opt_out_offset_seconds` | Detected English opt-out request and evidence. |
| `correlation_id`, `completed_at`, `event_id`, `event_type` | Record correlation, completion time, and notification envelope. |
| `notification_fresh` | Static trigger only: outcome timestamp is within the freshness window. |
| `reconciliation_timed_out` | Search only: result remains pending beyond the configured wait limit. |

v2 outputs omit legacy confidence, evidence, recipient and attempt counters.
A `calls_api: v1` historical result retains its old output shape and classifier.

## Dispositions

| Disposition | When produced |
| --- | --- |
| `confirmed` | Execution and telephone outcome completed; result available and usable; `business_confirmed` exactly true; supporting recipient quote found in the transcript. |
| `review_required` | No business confirmation, unavailable/empty result, no-answer/busy/declined, unknown or missing required answers, wrong scalar types, or missing/unmatched evidence. |
| `failed` | Technical execution/result error. |
| `canceled` | Explicit cancellation. |
| `outcome_unknown` | Result still pending, or a create has only been accepted. |
| `needs_human` | Unknown interface/status, failed verification, stalled reconciliation, or opt-out. |
| `outside_calling_window` | Create blocked by the supplied local-time policy. |
| `suppressed` | Create blocked by the supplied Do Not Call List. |
| `retry_policy_blocked` | Create blocked by the supplied attempt history. |
| `result_invalid` | Legacy v1 result-validation notification only; not emitted by v2. |

Only `confirmed` can be actionable, and the static trigger always overrides
that flag to false. Branch on `is_actionable` as well as the business fields.
`false` and zero are real scalar answers, but `business_confirmed: false`
explicitly prevents automatic confirmation. Unknown-like answers and missing
required fields require review. The wait action checks the original schema;
search and static trigger can only assess the fields actually returned.

### Transcript grounding and opt-out

`business_confirmed_quote` must match recipient speech. Additional
`<field>_quote` fields are also checked, including a quote the original schema
requested but the extraction omitted. Text matching normalizes punctuation,
case and spacing. A bot-only quote, paraphrase, or missing transcript cannot
confirm the result. English denial or uncertainty cues in a positive confirmation quote also route
to review. This conservative check can over-trigger on a qualified affirmation;
it does not interpret other languages. Short quotes can match by coincidence, so request the
full relevant statement and retain business validation where needed.

The opt-out check reads only recipient turns from the top-level v2 transcript.
A request such as “stop calling me” overrides all business results and routes
to `blocked_compliance`. A partially unreadable transcript cannot produce an
actionable result. This is an English phrase list, not multilingual intent
recognition; review other languages manually and update your own suppression
records before further contact. The integration does not write that list.

### Webhook verification

Both webhook surfaces treat the delivered body as a notification. They read
the named API Call through the connection's authenticated GET and classify
that record. A wrong resource ID, wrong interface, failed lookup, or callback
for another waiting run cannot confirm a result.

The static trigger ignores a notification for a Call the connection cannot
see. Other lookup failures surface as unverified manual work. Even a verified
Call can be replayed to a static URL: the trigger remains non-actionable,
and downgrades old successes using CALL-E's `completed_at` and a 15-minute
freshness window. Before a consequential write, use Find Call Result and
make the downstream write idempotent by API `call_id`.

### Reconciliation and retry

A callback wait has no plugin timeout hook. For a bounded wait, use Start
Call → Zapier Delay → Find Call Result with **Reconciliation Limit**. A result
still pending beyond that age becomes `needs_human`; no new Call is created.

The create key is a SHA-256 digest of the task, phone, region, locale, schema,
and metadata. Keep the original input, including omitted hints, and the
original Zap execution. The callback URL is stable within that execution.
It is excluded from the digest so a changed URL cannot silently create a
second Call: CALL-E returns `409 idempotency_conflict` instead. Do not fix a
conflict by generating a new key. If creation is in progress, retry unchanged
later. An intentionally new business event needs a distinct correlation ID.

Turning off a Zap prevents future submissions; it does not cancel accepted
Calls. This integration has no cancel action. CALL-E provides
`POST /v2/calls/{id}/cancel`; reconcile the accepted Call's state when using
that API separately.

## Testing

```sh
npm ci
npm test
```

Tests use a local fake server and `zapier-platform-core`'s `createAppTester`.
They cover v2 schema limits, payload/key stability, delayed and unavailable
results, opt-out, grounded business decisions, authenticated callbacks,
duplicate notifications, replay conflicts, and historical v1 lookups.
No credentials or real calls are required for the suite.

`package.json` must retain `type: module` and its `exports` map; Zapier's
runtime and build wrapper require them. The local SDK tester uses a fixed
callback URL. It can run `performResume` and the middleware chain but cannot
verify delivery through a hosted Zapier callback. A hosted test Zap and its
actual downstream writes remain a separate pre-release check.

### Verification on 2026-10-25

The local suite passed 405 tests across 26 files. An authorized call to the
CALL-E test hotline was submitted through the real Zapier SDK tester and
production API. A timed-out create was recovered with the saved original
body/key; the returned Call completed with an available, grounded business
confirmation. Replaying after completion returned the same API Call ID.
Authenticated search, local resume invocation, and static-trigger handling
all read that same Call; the static trigger remained non-actionable.

This verifies the service path and SDK handlers. It does not verify hosted
Zapier webhook delivery or CRM/Sheets writes, and no Zapier version was
published or online instance switched.
