# CALL-E Feedback Draft

This document is a draft for the optional CALL-E feedback survey. It contains no credentials, phone numbers, or private transcript content.

## What Worked Well

- The TypeScript SDK made a real call with a concise `calls.create` integration.
- Per-recipient JSON Schema produced a complete object that TinySlot could validate locally without a second model call.
- `task_completed`, completion confidence, evidence, recipient results, and attempts provide useful layers for safe reconciliation.
- Idempotency keys and durable call IDs support recovery after client failures.
- CALL-E handled a natural confirmation-style conversation and returned a high-confidence result.

## Most Valuable Improvement

`waitForResult` currently stops on a transient fetch or DNS failure. During TinySlot's live validation, create returned a durable call ID and the call completed successfully, but polling encountered intermittent `fetch failed` errors. An SDK retry policy for retryable connection failures, with bounded exponential backoff and the same call ID, would make the safest integration pattern the easiest one.

Suggested behavior:

1. Never repeat `POST /v1/calls` after a call ID was returned.
2. Retry only `GET /v1/calls/{id}` for bounded network and 5xx failures.
3. Expose retry progress through an optional callback.
4. Return the last known status with a timeout error so applications can persist and resume.

## Structured-Result Feedback

The live result correctly retained separate tuition and registration-fee fields, but spoken numeric answers can be terse or ambiguous. Useful additions would be:

- transcript-span identifiers attached to each structured field;
- a field-level confidence or extraction warning;
- explicit correction metadata when a speaker revises a number;
- schema support for `unknown` numeric values without sentinel integers such as `-1`.

## Developer Experience Feedback

- A read-only list or lookup-by-idempotency-key endpoint would help recover when create fails before the client receives a call ID.
- Document which metadata value shapes are supported, especially nested arrays and objects.
- Publish a recommended resilient polling helper that distinguishes terminal call failure from temporary client connectivity failure.
- Include a local fake server with the SDK so applications can test queued, in-progress, correction, voicemail, and malformed-result paths consistently.
