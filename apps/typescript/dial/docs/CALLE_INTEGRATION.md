# CALL-E integration

Everything here was verified against the shipped `@call-e/calle@0.7.0` package,
not inferred from documentation prose. Where a fact is stated, the file it came
from is named.

## Source-of-truth check

`npm view @call-e/calle version` → `0.7.0` (latest). The SDK guide in the docs
repository still describes `0.2.2`, so **the package is ahead of the docs** and
the package wins (§2's hierarchy places the functional codebase above prose).

## Client surface used

From `dist/calls.d.ts`:

```ts
new CalleClient({ apiKey, baseUrl?, fetch? })
client.calls.create(input: CreateCallInput, options?: { idempotencyKey?: string }): Promise<Call>
client.calls.get(callId: string): Promise<Call>
```

`CreateCallInput`: `task`, `recipient?`, `recipients?`, `resultSchema?`,
`recipientResultSchema?`, `metadata?`, `webhookUrl?`.

**Used:** `create` and `get`.
**Deliberately not used:** `createAndWait`, `waitForResult` — they hold a thread
for up to two minutes (§5 forbids depending on an open request); `client.goals.*`
— a preview surface (see DECISIONS §13).

Implementation: `packages/calle/src/calle-provider.ts`.

## Vocabulary, transcribed verbatim

`packages/schemas/src/calle.ts` mirrors the wire enums exactly:

```
CallStatus       queued | in_progress | completed | failed | canceled
AttemptStatus    + dialing
RecipientStatus  pending | in_progress | completed | failed | skipped
Speaker          bot | user | unknown
Webhook events   call.completed | call.failed | call.result_validation_failed
```

CALL-E's five statuses are persisted verbatim in `calls.provider_status`. Dial's
own judgement lives in a separate `disposition` column so the two are never
confused. **"Needs review" is not a CALL-E status** — it is Dial's reading of a
`structured_result: null`.

## Result schemas

`result_schema` accepts a **subset** of JSON Schema. Supported: `type`,
`properties`, `required`, `enum`, nested objects, simple `array.items`,
`description`, `additionalProperties: false`. Not supported: `$ref`, `oneOf`,
`anyOf`, `allOf`, recursion, complex `format`.

This is why the schemas are hand-written rather than generated from Zod —
`z.toJSONSchema` emits `$ref`/`anyOf` for ordinary shapes, which would come back
as `result_schema_invalid` at dispatch time, after the user has already asked
for the work.

`assertCalleSchemaSupported()` enforces the subset locally, and a test asserts
every shipped schema passes it. A second test asserts none uses CALL-E's
reserved recipient field names — it caught a real collision on `status`
(DECISIONS §10).

Seven families ship: `repair_quote`, `service_quote`, `reservation`,
`appointment`, `availability_check`, `status_check`, `general_inquiry`. Adding a
domain means adding a family, not an application.

### The most important behaviour

> If CALL-E cannot produce a schema-valid result, `structured_result` is `null`.

That is the honest "do not act" signal. Dial propagates it as the
`needs_review` disposition, and the comparison engine treats such a call as
unusable rather than as a zero-price win. Tested in
`apps/api/src/__tests__/pipeline.test.ts`.

## Idempotency

`Idempotency-Key` is a first-class header, and the docs are explicit: *use a
stable workflow key, not a random UUID generated at each retry*.

```ts
callIdempotencyKey(taskId, candidateId, attempt) // "dial:<task>:<candidate>:1"
```

Derived from the workflow, never regenerated. Backed by a unique index on
`calls.idempotency_key`, so even a redelivered job cannot dial the same business
twice. This is what makes at-least-once queue delivery safe.

## Webhooks

Deliveries are **not signed**. `webhooks.verify()` and `webhooks.unwrap()` are
both marked `@deprecated` in `dist/webhooks.d.ts` for exactly that reason: there
is no secret, no timestamp header and no signature header.

The receiver (`packages/orchestrator/src/webhook.ts`) therefore treats a
delivery as an untrusted hint that something finished:

1. Validate payload structure with Zod.
2. Require the `CALL-E-Event-Id` header to equal the body `id`.
3. `INSERT ... ON CONFLICT DO NOTHING` on the event id — a replay is a no-op by
   construction, before any work happens.
4. Look up the call by `provider_call_id`; acknowledge and stop if unknown.
5. **Re-fetch the call from CALL-E with our own API key** and persist that.

Step 5 is the one that matters: nothing a caller POSTs is ever written to a call
record. A test posts a hostile delivery claiming a €1 quote and asserts the
stored price is still the €95 the authenticated re-fetch returned.

Duplicates and unknown calls return `200` — CALL-E treats any 2xx as delivered,
and re-delivery of something already handled is not an error.

## Error handling

All 23 codes from `APIError.code` are enumerated. Only
`rate_limit_exceeded`, `provider_unavailable`, `internal_error` and connection
errors are treated as retryable — redialling after `invalid_phone` just rings a
stranger twice and burns credit.

`insufficient_balance`, `unauthorized` and `forbidden` stop the whole task
rather than repeating per candidate, since they affect every remaining call.

Each code maps to plain language for the UI (`describeCalleError`), because §36
forbids leaking machine vocabulary into the normal experience.

## Cancellation

The Calls API exposes no client-initiated cancellation. Dial never renders a
cancel-call button. Cancelling a task stops everything not yet dispatched and
says explicitly how many calls were already connecting:

> "2 calls were already connecting and cannot be pulled back."

## Placing a real call

`npm run calle:verify -- --to +353...` places exactly one real call, to one
number given explicitly on the command line. It refuses to read a number from
discovery — dialling a real business has to be a deliberate act, not a side
effect of a test script.
