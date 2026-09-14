# Adapter notes

Contract decisions for PositiveContact, taken against the published CALL-E contract before any
code was written. Sources:

- `https://docs.heycall-e.com/openapi/calle.openapi.yaml` (CALL-E Developer API `0.7.0`, OpenAPI
  `3.1.0`). Referred to below as "the spec".
- `https://github.com/CALLE-AI/call-e-integrations` README, section "Supported Regions and
  Languages". Referred to below as "the integrations table".

Where the spec and `ARCHITECTURE.md` disagree, the spec wins and the deviation is recorded here.

## Endpoints this app uses

| Purpose | Call |
| --- | --- |
| Submit one call | `POST /v1/calls` with an `Idempotency-Key` header |
| Authoritative re-read | `GET /v1/calls/{call_id}` |
| Terminal wake-up | `POST /calle/webhook` on our own receiver |

Base URL `https://api.heycall-e.com`. Auth is `Authorization: Bearer <CALLE_API_KEY>`
(`bearerAuth`, HTTP bearer).

`call_id` matches `^call_[A-Za-z0-9_-]+$`. The spec is explicit that `provider_call_id` on an
attempt is a Dashboard correlation value and must not be used as `call_id`; this app never does.

## Answers to ARCHITECTURE.md section 17

### 1. Is there a voicemail / answering-machine indicator separate from `structured_result`?

**No.** The spec exposes no answering-machine signal at any level:

- `CallStatus` is `queued | in_progress | completed | failed | canceled`.
- `RecipientStatus` is `pending | in_progress | completed | failed | skipped`.
- `AttemptStatus` is `queued | dialing | in_progress | completed | failed | canceled`.
- `failure_code` (task and attempt) is documented as "No published enum" with the instruction:
  "Preserve raw values for support; do not branch retry, reporting, or analytics logic on specific
  values."

**Chosen path (the "If no" branch):** Judge B's transcript greeting-pattern detection carries
voicemail detection. Judge A classifies from `recipients[].structured_result.contact_type` only and
never guesses voicemail from a status value.

The contradiction check stays **enabled**, but it is redefined against what the contract actually
provides. `ARCHITECTURE.md` section 10 phrases the contradiction row as "platform says voicemail,
result says `acknowledged=yes`". There is no platform voicemail signal to say that, so the
contradiction this app detects is **Judge B (transcript shows a machine greeting) against Judge A
(structured result claims a live person acknowledged)**. That is the same failure mode the row was
written to catch, sourced from the only evidence the contract publishes. `failure_code` and
`failure_message` are stored verbatim in the redacted snapshot for support, and are never branched
on.

### 2. Does the Python SDK accept an idempotency key?

**Yes.** `calle-ai` exposes `client.calls.create(..., idempotency_key=...)`; this repository already
uses that form in `apps/python/blood-bank-dispatch/app/dispatch.py`.

**Chosen path:** the live transport is still implemented over `httpx` against the documented REST
contract, for three reasons:

1. Every call this app places needs `recipient_result_schema`. The SDK versions pinned across this
   repository differ (`calle_ai 0.2.0` in `apps/python/incidentbridge/uv.lock`, `0.6.0` in
   `apps/python/callback-coordinator/uv.lock`), so that keyword's availability is version-dependent
   while the REST field is fixed by the published contract.
2. `pc record` has to persist the exact wire JSON so `replay` mode adjudicates real response
   shapes. Going through the REST body keeps the recorded payload byte-faithful to the contract.
3. The webhook path needs the raw `CALL-E-Event-Id` header, which is a receiver-side concern the
   SDK does not cover.

`calle-ai` is declared as an optional `sdk` extra rather than a required dependency, so fixture and
replay mode (and the whole test suite) install and run without it.

### 3. Does the webhook payload carry an authentication mechanism?

**No.** The `/calle/webhook` path sets `security: []` and the spec defines no signature header,
timestamp, or shared secret. The only identity on the request is the `CALL-E-Event-Id` header
(required, pattern `^evt_[A-Za-z0-9_-]+$`), which the spec describes as an idempotency handle:
"Store this value before side effects so duplicate deliveries can be ignored safely."

**Chosen path:** the webhook is a **wake-up signal only**. The receiver validates the envelope,
inserts one `inbox` row keyed on the event id, commits, and returns `200 {"ok": true}`. No business
transition is ever driven by webhook body content. A worker re-reads `GET /v1/calls/{call_id}` and
adjudicates the response of that read.

Two extra guards, both derived from the contract rather than invented:

- The header event id and the body's top-level `id` must match. A mismatch is quarantined.
- The spec warns that the top-level `id` is the *event* id while `data.id` is the *call* id. The
  inbox deduplicates on the event id and binds to `data.id` for the re-read.

### 4. Is `es-US` (or any non-English locale) supported on the US line?

**No.** The integrations table lists exactly one language for the United States:

| Country | Country Code | Calling Code | Languages | Line Region |
| --- | --- | --- | --- | --- |
| United States of America | `US` | +1 | English | Local |

Spanish appears only for `MX` and `ES`, Vietnamese only for `VN`, Chinese only for `MY`. None of
those is reachable on a `+1` US destination.

**Chosen path (the "If no" branch):** `supported_locales` stays `["en-US"]`. A roster row in any
other locale is never called in English anyway. It routes to
`unsupported_locale_action = needs_human_bilingual_callback` at preflight, before an intent is
reserved, and is counted in the report under its own denominator. The demo roster carries a `vi-VN`
contact so this path is exercised rather than described.

The spec backs the fail-closed choice with a dedicated error code: `unsupported_language`
(alongside `unsupported_region`). Calling anyway would trade a refusable preflight failure for a
billable call that fails at the provider.

### 5. Does `POST /v1/calls` accept a scheduled start time?

**No.** `CreateCallRequest` is `additionalProperties: false` and its full property set is `task`,
`recipients`, `result_schema`, `recipient_result_schema`, `metadata`, `webhook_url`. There is no
`start_at`, `scheduled_for`, or delay field.

**Chosen path:** host-side scheduling. Every ladder step is persisted as an `intents` row with a
`not_before` timestamp, and the intent is only dispatched once the clock passes it. In fixture mode
the clock is simulated so a full ladder runs in seconds; in live mode `pc serve` is the loop. This
also matches repository design principle 1 (the host owns recurrence, the provider places exactly
one call).

### 6. Which terminal statuses exist besides `completed`?

`CallStatus` terminal values are `completed`, `failed`, and `canceled`. `queued` and `in_progress`
are non-terminal; the spec notes `in_progress` "includes post-call result finalization; terminal
states are published only after the post-call outcome is available", so a terminal status already
implies the structured result is final.

Explicit mapping used by the adjudicator:

| Terminal `status` | Handling |
| --- | --- |
| `completed` | Adjudicate normally against the section 10 table |
| `failed` | `UNKNOWN` -> one authoritative re-read -> still not `completed` -> `NEEDS_HUMAN`, no auto redial |
| `canceled` | Same as `failed`. `canceled` is a status CALL-E sets; this app never requests it |

Webhook event types are `call.completed`, `call.failed`, and `call.result_validation_failed`. All
three are treated identically on arrival: insert an inbox row, re-read, adjudicate the read.
`call.result_validation_failed` is worth naming separately because it is the wake-up that
accompanies a `null` `structured_result`, which routes to `NEEDS_HUMAN`.

## Deviations from ARCHITECTURE.md, with reasons

### `maxLength` is dropped from the transmitted schema

`ARCHITECTURE.md` section 9 says to keep the recipient schema to `object`, `string`, `enum`,
`required`, and `maxLength`. The spec's supported-feature list for `recipient_result_schema` is:

> Supported schema features are `type`, `properties`, `required`, `enum`, nested `object` fields,
> simple `array.items`, `description`, and `additionalProperties: false`. Unsupported features
> include `$ref`, `oneOf`, `anyOf`, `allOf`, recursive schemas, complex format validation, and
> `additionalProperties: true`.

`maxLength` is not on that list. Sending it risks `recipient_result_schema_invalid` (a published
error code), which would fail the call rather than trim a field.

**Decision:** the wire schema carries no `maxLength`. The length bound moves into the field
`description` (which the spec says is passed to the extraction model), and the strict local
validator in `script.py` enforces the real limit after the call. This is fail-closed in the right
direction: an over-long `notes_for_human` becomes a local validation failure that routes to
`NEEDS_HUMAN`, not a rejected call.

### `additionalProperties: false` is added to the transmitted schema

Section 9's JSON block omits it. The spec both supports it and warns that "Object schemas are
strict by default. Fields not declared in `properties` are rejected". Stating it explicitly matches
the spec's own examples and the strict local validator's "no unexpected keys" rule.

### Reserved recipient field names

The spec forbids reusing reserved recipient response field names as custom result fields:
`summary`, `status`, `transcript`, `call_id`, and timing fields. The section 9 schema already
avoids all of them; section 9's "Do not name any field `summary`" is this rule, and the full list is
wider. Recorded here so a future schema edit does not reintroduce one.

### `metadata` carries the binding, and the binding is verified on re-read

The spec describes `metadata` as "caller-owned metadata echoed on the call and webhook payloads.
Use this for workflow ids, tenant ids, or internal correlation keys." Every submission sends:

```json
{"pc_event_id": "...", "pc_contact_id": "...", "pc_intent_id": "...",
 "pc_ladder_step": "1", "pc_target": "primary",
 "pc_task_version": "...", "pc_schema_version": "..."}
```

`ARCHITECTURE.md` section 6 requires the `TERMINAL_UNVERIFIED -> ADJUDICATED` edge to pass
"binding checks" without naming the mechanism. This is it. On re-read the worker requires the
returned `id` to equal the stored `call_id`, and the echoed metadata to equal the stored intent's
values. Any mismatch appends `TERMINAL_UNVERIFIED -> NEEDS_HUMAN` with reason
`binding_mismatch`, and no disposition is written.

### The confidence gate reads a label with no published enum

`CompletionConfidence` requires `score` (0 to 1) and `label`, but `label` is a free `string`
described only as "for example `low`, `medium`, or `high`". `completion_confidence` itself is
nullable until a terminal post-summary outcome exists.

**Decision:** confidence passes when `label` case-folds to `high` **or** `score >=
confidence_threshold` (default `0.80`), exactly as section 10 words it. A `null`
`completion_confidence`, a missing score, and an unrecognized label all fail the gate, so the
unknown case never produces `CONFIRMED`.

### One recipient per call, and the result is read from the recipient

Submissions send exactly one entry in `recipients` with `locale: "en-US"` and `region: "US"`, plus
a `recipient_result_schema`. The disposition is read from `recipients[0].structured_result`, not
from the task-level `structured_result`. The spec: "`null` means CALL-E could not produce a
schema-valid result for this recipient from the terminal call evidence, or no
`recipient_result_schema` was provided" and "unsupported or invalid recipient results are returned
as `null`". A `null` recipient result therefore routes to `NEEDS_HUMAN`, never to an inferred
outcome. No task-level `result_schema` is sent, because with one recipient it would only duplicate
the same evidence under a second extraction.

### Transcript turns may carry a null offset

`CallTranscriptTurn.offset_seconds` is `integer | null`: "`null` when the source line did not
include a parseable timestamp." Judge B therefore orders turns by array position and treats
`offset_seconds` as display metadata on an evidence span, never as the ordering key.

### The idempotency key must fit in 255 characters

The `Idempotency-Key` header schema is `minLength: 1, maxLength: 255`. The key format from the
build prompt, `pc:{event_id}:{contact_id}:{ladder_step}:{target}`, is validated against that bound
at preflight, so an over-long event or contact id is refused before any intent is reserved rather
than being silently truncated into a colliding key.

Reusing a key with a changed body returns `409 idempotency_conflict`. This app never changes a
body for a given key: the key is derived from the intent, and the task text and schema versions are
pinned on the intent row when it is reserved.

### There is no cancel endpoint

The spec's complete path list is `/v1/calls` (POST), `/v1/calls/{call_id}` (GET),
`/v1/calls/{call_id}/events` (GET), the `/v1/goals` family, and the `/calle/webhook` receiver
contract. Nothing cancels an in-flight call. `canceled` is a `CallStatus` CALL-E may set on its
own. Confirmed as stated in `ARCHITECTURE.md` section 3 and documented as a boundary in the app
README.

## Error codes this app handles by name

`APIError.code` is a closed enum in the spec. The submission path maps these explicitly and treats
every other code as an unknown submission outcome:

| Code | Handling |
| --- | --- |
| `idempotency_conflict` | Never retried with a new key. Reconcile or route to a human |
| `unsupported_language`, `unsupported_region` | Preflight should have caught it; route to bilingual callback, no redial |
| `invalid_phone`, `invalid_recipient`, `no_recipients` | Roster defect. `NEEDS_HUMAN`, never repaired |
| `recipient_blocked`, `policy_violation` | `NEEDS_HUMAN`, no redial |
| `recipient_result_schema_invalid`, `result_schema_invalid` | Build defect. Fail the run loudly |
| `rate_limit_exceeded`, `provider_unavailable`, `internal_error` | Submission outcome unknown; `SUBMISSION_UNKNOWN`, reconcile by lookup, never a new key |
| `insufficient_balance` | Fail the run loudly; do not silently drop contacts from the ladder |

## Polling

`POST /v1/calls` returns `201` with a `CallTask` whose `status` is typically `queued`. The poller
waits about 60 seconds, then re-reads every 5 to 10 seconds until `status` is terminal. The
`call_id` is persisted on the `attempts` row before the first poll, so a restart resumes polling an
existing call instead of resubmitting one.
