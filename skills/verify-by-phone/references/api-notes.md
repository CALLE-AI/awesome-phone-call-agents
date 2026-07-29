# CALL-E API Notes For Verification Workflows

Empirically observed behaviors this skill relies on, recorded from live testing in July 2026. Where the observed API differs from documentation, the observation is stated plainly so the skill keeps working.

## Terminal payload shape (observed live)

`GET /v1/calls/{id}` returns a snake_case `call_task` object. The fields that matter for verification:

```text
status                        queued | completed | failed | canceled
task_completed                boolean, whether the stated goal was achieved
completion_confidence         {score: float, label: string}
evidence                      list of short claim strings about the call
summary                       human-readable outcome summary
recipients[].attempts[].transcript_turns[]
                              {offset_seconds, speaker: bot|user, text}
recipients[].structured_result   null unless a result schema was applied
```

`transcript_turns` is the extraction surface: per-turn speaker labels with second offsets, which is what makes span grounding and audio-synchronized highlighting possible.

## Result schema parameters (observed rejection)

As of late July 2026 the live API rejects both `result_schema` and `recipient_result_schema` on `POST /v1/calls` with "... is not supported", even though the Python SDK exposes both parameters. This skill therefore never depends on provider-side structured results: extraction happens client-side from the transcript, which also keeps every answer span-grounded. If the schema parameters start working, note that `summary` is a reserved field name inside `recipient_result_schema` and will be rejected; use `notes`.

## Idempotency

`Idempotency-Key` on call creation is honored: resubmitting with the same key returns the same call instead of dialing twice.

`place_verify_call.py` derives its key from the verification itself, `sha256(org, phone, claims, UTC date)`, rather than generating a random one per run. This matters because the natural recovery from a lost response is to run the same command again, and with a random key that dials a real office a second time. A derived key makes the obvious recovery the safe one.

The key is scoped to a single UTC day on purpose. A key derived from the parameters alone would be permanent, so re-verifying the same listing next month would silently return last month's answer, and for this tool a stale cached result is a worse failure than a duplicate call.

Two consequences worth knowing:

- The key is printed **before** the request is sent, not after it succeeds. A key first disclosed in the success response is useless in the exact situation it exists for.
- A call placed at 23:59 UTC and retried at 00:01 derives a different key. Pass `--idempotency-key <printed key>` to retry with the exact key regardless of the boundary. The failure message prints that flag with the key already filled in.

## Webhooks

The SDK ships a verifier for HMAC-SHA256 signatures over `timestamp + "." + raw_body` (`CALL-E-Signature: v1=<hex>` plus `CALL-E-Timestamp`), and its verifier checks the signature but not timestamp freshness, so integrators should enforce their own replay window over the exact raw bytes.

Observed live, late July 2026: `webhook_url` on call creation is ACCEPTED silently but NO webhook was delivered for a completed call (verified with a public tunnel capturing all traffic; the call reached terminal, the tunnel stayed healthy, nothing arrived). Until delivery demonstrably works, treat polling `GET /v1/calls/{id}` as the authoritative terminal path and the webhook as a future optimization, and keep any webhook receiver fail-closed.

## Billing behaviors relevant to verification runs

Per public statements from the CALL-E team: no-answer calls and failed routes are not billed; voicemail and low-confidence results bill the call fee only. A verification sweep over stale listings, where many numbers are dead, is therefore cheaper than the raw listing count suggests.

## Capabilities to not assume

No call cancellation, no inbound answering, no mid-call developer tool use, no real-time transcript streaming. DTMF phone-tree navigation exists platform-side but is not yet generally available; do not build verification flows that require reliable IVR traversal.
