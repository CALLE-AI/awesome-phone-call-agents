# Audit record format

One JSON object per line, appended, never rewritten. Each record covers one gate
run: the change, the policy, every attempt and the verdict.

## Why the record carries its own inputs

A log that says `verdict: approved` proves nothing. Anyone with write access can
type that. So each attempt stores the exact inputs the outcome was computed from
and verification recomputes the outcome with the same function the gate used
live. Three independent checks run over every record:

1. **Chain.** `prev_hash` links to the previous record and `hash` is recomputed
   over the record contents, so an edit anywhere breaks the link.
2. **Decision.** The decision is re-read from the stored excerpt with the same
   matcher the gate used, so rewriting the excerpt to say approve is caught.
3. **Outcome.** `attemptOutcome` and `verdictFromAttempts` run again on the
   recorded inputs, so a verdict that does not follow from the evidence fails
   even when the hash was recomputed to match.

The third check is the one a plain append-only log cannot do. `npm run demo`
finishes by forging a verdict, recomputing its hash and showing verification
reject it.

## Fields

```json
{
  "seq": 1,
  "recorded_at": "2026-07-29T10:01:12.004Z",
  "request_id": "deploy-1842",
  "request_digest": "sha256:...",
  "change": {
    "title": "Deploy checkout-api 1.14.2 to production",
    "summary": "Adds a retry on the payment webhook handler.",
    "environment": "production",
    "requested_by": "workflow run 1842",
    "links": ["https://example.com/acme/checkout-api/actions/runs/1842"]
  },
  "policy": {
    "mode": "single",
    "binding": "code_from_request",
    "per_call_timeout_seconds": 240,
    "window_seconds": 600,
    "min_confidence": 0.5,
    "max_failed_attempts": 3,
    "allow_structured_only": false
  },
  "secret_delivery": "request_channel",
  "attempts": [
    {
      "approver_id": "release-owner",
      "phone_masked": "+14*******00",
      "call_id": "call_123",
      "provider_call_id": "provider_call_123",
      "outcome": "approved",
      "reason": null,
      "evidence": {
        "call_status": "completed",
        "failure_code": null,
        "reached_person": true,
        "machine_answered": false,
        "transcript_available": true,
        "code_match": true,
        "decision": "approve",
        "structured_decision": "approve",
        "confidence": { "score": 0.94, "label": "high" }
      },
      "secret_digest": "sha256:...",
      "spoken_secret_digest": "sha256:...",
      "transcript_excerpt": ["[code], I approve."],
      "started_at": "2026-07-29T10:00:05Z",
      "completed_at": "2026-07-29T10:01:00Z"
    }
  ],
  "verdict": "approved",
  "reason": null,
  "approved_by": ["release-owner"],
  "prev_hash": "sha256:0000...0000",
  "hash": "sha256:..."
}
```

`request_digest` covers the change, the resolved policy and the approver ids, so
two records for the same `request_id` with different content are visible as such.

`secret_digest` and `spoken_secret_digest` are `sha256(request_id + ":" + secret)`.
Equal digests mean the code came back correctly. The salt keeps digests from
being comparable across requests. The secret is single use and expires with the
window, so this digest is a binding aid and not a place to hide a lasting value.

## Hashing rule

`hash` is `sha256` over the canonical JSON of the record without the `hash`
field. Canonical JSON sorts object keys, drops `undefined` values and adds no
whitespace, so the hash depends on values rather than on formatting. The first
record in a file links to
`sha256:0000000000000000000000000000000000000000000000000000000000000000`.

## Verifying

```bash
npm run gate -- verify --audit approvals.jsonl
npm run gate -- verify --audit approvals.jsonl --json
```

Exit code 0 means the chain and every recorded verdict hold. Exit code 40 means
at least one check failed and each problem is printed with its record number.

## Reconciling with CALL-E

The record stores `call_id` and `provider_call_id` for each attempt. To confirm a
record describes a call that really happened, look the call up through the CALL-E
API or dashboard and compare the recipient, the timestamps and the metadata,
which carries `request_id`, `approver_id` and `environment`. A record with no
matching CALL-E call is the interesting case.

## Retention

Records are appended with file mode `0600`. NIST SP 800-53 Rev 5 CM-3 expects
change decisions to be documented and retained for an organization-defined
period, so treat the file the way your change management policy already treats
approval evidence. In CI, upload it as a build artifact on every run, including
runs that were not approved.
