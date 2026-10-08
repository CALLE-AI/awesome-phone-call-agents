# CALL-E API Notes For Verification Workflows

This skill uses published `calle-ai==1.0.1` and the [Calls V2 contract](https://docs.heycall-e.com/api-reference/calls). See the [migration guide](https://docs.heycall-e.com/migration) when adapting an existing V1 integration.

## Request and response

`POST /v2/calls` takes one E.164 `phone`, `task`, a required `Idempotency-Key`, and a closed, flat `result_schema`. The schema supports scalar fields; nested objects, arrays and nullable fields are unsupported. The script supplies three string fields for organization confirmation, accepting-new-patients status and plan participation. Optional region and locale are omitted so the service can infer them. Keep them omitted on retries.

A `202` response means durable acceptance. It does not prove the phone connected or that the directory information was verified. Save the response's API `id` for `GET /v2/calls/{id}`; `call_id` is a separate telephone identifier for Billing and can be null.

The fields used by this workflow are:

```text
status          queued | in_progress | completed | failed | canceled
call_outcome    completed | no_answer | busy | declined | null
result_status   pending | available | unavailable | not_applicable
result          schema-valid object, or null
transcript[]    {offset_seconds: integer|null, speaker: bot|user|unknown, text: string}
error           technical error object, or null
```

Poll only while `result_status` is `pending`. Execution may already be `completed` while the result is still pending. `unavailable` means no schema-valid business result was produced; `not_applicable` covers cancellation and technical execution failure. No-answer, busy and declined calls need not have a technical error.

`extract_answer.py` uses the top-level `transcript`, independently of `result`. Provider-extracted fields are not evidence for its span-grounded verdict. Empty transcripts produce explicit abstentions. A V2 transcript containing an `unknown` speaker makes the entire call abstain: the extractor cannot attribute that turn to the respondent. The original payload and turn order are retained unchanged. Previously saved V1 payloads with `recipients[].attempts[].transcript_turns` remain readable, so old evidence does not require another call.

## Idempotency and local state

Each logical call needs one immutable request and one stable key. Replaying the same request and key returns the original API Call ID and its current saved state without preparing or dialing again. Changing the request with the same key produces `409 idempotency_conflict`. A `creation_in_progress` conflict means back off and replay the unchanged request with the original key; do not generate a new one.

`place_verify_call.py` initially derives a key from the organization, phone, claims and UTC date, or accepts `--idempotency-key`. Before sending, it saves that key and the full request in the `--state` file (default `verify-call.json`, mode 0600). After acceptance it saves the API `id` there too. Subsequent runs reuse the saved key, even across the date boundary, and reject input that differs from the saved request.

After a timeout or uncertain response, retain the state file and retry with the same arguments. A known Call ID can instead be polled directly. For an intentionally new call, use a new state path and fresh `--idempotency-key` after resolving any uncertain prior acceptance; the default key deduplicates identical same-day requests. Both state and result files contain the unmasked phone number; delete them when the verification is recorded and retry recovery is no longer needed.

## Webhooks

Current CALL-E webhooks are unsigned. Treat a delivery as an untrusted wake-up signal, then fetch `GET /v2/calls/{id}` with your API key before processing a result. The SDK's legacy signature helpers do not authenticate current deliveries. See the [webhook guide](https://docs.heycall-e.com/webhooks).

This skill polls instead of running a receiver. Terminal notifications follow result readiness, including unavailable results.

## Cancellation and billing

Calls V2 exposes cancellation before provider submission through `client.calls.cancel(id)`. Once submission starts, cancellation returns `409 call_cannot_cancel`; it does not hang up an active call. Stopping local polling does not cancel the call. See [Cancel Call](https://docs.heycall-e.com/api-reference/calls).

Use [Dashboard Billing](https://dashboard.heycall-e.com/account/billing) for actual charges. Execution completion, confidence labels and result availability are not billing receipts.
