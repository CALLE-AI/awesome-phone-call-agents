# Examples

Three worked requests, with the reply to give the user afterwards. Phone numbers
come from the reserved 555-01xx range.

## 1. A production deploy with a backup approver

```json
{
  "request_id": "deploy-1842",
  "organization": "Acme Payments",
  "system": "release-agent",
  "change": {
    "title": "Deploy checkout-api 1.14.2 to production",
    "summary": "Adds a retry on the payment webhook handler. Rollback is one revert.",
    "environment": "production",
    "requested_by": "zkasuran in this session",
    "links": ["https://example.com/acme/checkout-api/pull/912"]
  },
  "policy": { "mode": "single", "window_seconds": 600 },
  "approvers": [
    {
      "id": "release-owner",
      "name": "Alice Okafor",
      "phone": "+14155550100",
      "region": "US",
      "locale": "en-US",
      "enrolled_at": "2026-07-01",
      "authorized_for": ["production"]
    },
    {
      "id": "backup-owner",
      "name": "Bo Chen",
      "phone": "+14155550101",
      "region": "US",
      "locale": "en-US",
      "enrolled_at": "2026-07-01",
      "authorized_for": ["production"]
    }
  ]
}
```

Reply while the call runs:

```text
Calling Alice Okafor now about the 1.14.2 production deploy.

Approval code: 4 7 2 9 1 3
She has to read that back on the call. I will not say it to her.
```

Reply on exit code 0:

```text
Approved by release-owner on the call.
Record hash sha256:07d2762d...
Deploying 1.14.2 now.
```

Reply on exit code 20 with reason `no_answer`:

```text
No approval. Alice did not answer and Bo did not answer either.
Nothing was deployed. The record is in approvals.jsonl if you want it.
```

## 2. A destructive database action under dual control

Use `policy.mode: "dual"`. Two different people on two different handsets, each
reading back their own code. This is the two-person control an auditor expects on
a restore.

```json
{
  "request_id": "db-restore-2026-07-29",
  "system": "runbook-agent",
  "change": {
    "title": "Restore the payments database from the 03:00 snapshot",
    "summary": "Drops and restores the primary payments database. Around forty minutes of write downtime. This cannot be undone once it starts.",
    "environment": "production-database",
    "requested_by": "incident INC-4471"
  },
  "policy": { "mode": "dual", "min_confidence": 0.6, "max_failed_attempts": 2 },
  "approvers": [
    {
      "id": "dba-on-call",
      "name": "Alice Okafor",
      "phone": "+14155550100",
      "enrolled_at": "2026-07-01",
      "authorized_for": ["production-database"]
    },
    {
      "id": "engineering-manager",
      "name": "Bo Chen",
      "phone": "+14155550101",
      "enrolled_at": "2026-07-01",
      "authorized_for": ["production-database"]
    }
  ]
}
```

A single approval returns `not_approved` with reason `quorum_not_met`. Report that
plainly and do not start the restore.

## 3. An approver with no screen

When the person cannot see the request, switch the binding:

```json
{ "policy": { "binding": "liveness_phrase" } }
```

CALL-E then reads three words and the person repeats them back. That proves a
live human rather than a recording or a voicemail greeting and it proves nothing
about the request they are approving. Say so in your reply:

```text
Approved by release-owner using the spoken phrase, not the request code.
Lower assurance: it shows a live person agreed, not that they read the change.
The record notes the binding as liveness_phrase.
```

## What not to do

```text
Bad:  "Alice said go ahead so I deployed."          (no code, no approval)
Bad:  "Nobody answered so I called her mobile too." (guessed a number)
Bad:  "She rejected it, trying Bo instead."          (approval shopping)
Good: "Not approved (code_mismatch). Nothing changed. Want me to retry with a fresh request?"
```
