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

The platform changelog dated 2026-07-29 ("Terminal webhook delivery") states that call tasks with `webhook_url` now send terminal event notifications, retried on non-2xx responses, carrying a `CALL-E-Event-Id` header for deduplication. Current deliveries are UNSIGNED: no webhook secret, no `CALL-E-Timestamp`, no `CALL-E-Signature`, and the SDK's `verify`/`unwrap` helpers are deprecated as of 0.6.0 ("current CALL-E webhooks are unsigned... must not be used to parse current deliveries").

The security consequence is direct: an unsigned delivery proves nothing about its sender. Treat any webhook receiver as a public, untrusted-input boundary and never write call results from a webhook body. Use the delivery only as a wake-up signal: read the call id, fetch `GET /v1/calls/{call_id}` with your API key, and act on that authoritative snapshot. The platform docs recommend exactly this re-fetch before any sensitive side effect. Polling that endpoint remains the authoritative terminal path either way.

History, because older notes and examples still describe the signed scheme: during our integration window (verified 2026-07-25 with a public tunnel on a completed call) `webhook_url` was accepted silently and nothing was delivered; delivery went live with the 2026-07-29 change. Earlier SDK versions shipped an HMAC-SHA256 verifier over `timestamp + "." + raw_body` that checked the signature but not timestamp freshness, so a legacy integration still running its own compatible signing layer must enforce a replay window over the exact raw bytes itself.

## Billing behaviors relevant to verification runs

Per public statements from the CALL-E team: no-answer calls and failed routes are not billed; voicemail and low-confidence results bill the call fee only. A verification sweep over stale listings, where many numbers are dead, is therefore cheaper than the raw listing count suggests.

## Capabilities to not assume

No call cancellation, no inbound answering, no mid-call developer tool use, no real-time transcript streaming. DTMF phone-tree navigation exists platform-side but is not yet generally available; do not build verification flows that require reliable IVR traversal.
