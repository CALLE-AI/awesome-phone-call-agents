# Dashboard Writeback

How a validated lead result reaches the business dashboard, and the credential and retry rules around that post.

## Payload

One JSON object per terminal attempt, posted to the configured webhook:

```json
{
  "schema": "callbackops/lead-result@1",
  "event_id": "mc-2026-08-15-000042",
  "outcome": "recovered",
  "masked_caller": "+1555****0142",
  "business_name": "Example Dental",
  "lead": {
    "lead_intent": "Booking",
    "need_summary": "Wants a cleaning appointment this week",
    "urgency": "Urgent",
    "callback_slot": "tomorrow morning, maybe before noon",
    "wants_booking": true,
    "notes": ""
  },
  "attempt": { "number": 1, "cap": 2, "idempotency_key": "recovery:mc-2026-08-15-000042:a1b2c3d4" },
  "posted_at": "2026-08-15T18:04:31Z"
}
```

Rules:

- The caller's number is masked in the payload. The dashboard joins the full number from the phone system record by `event_id` if it needs it; the skill does not transmit it.
- `callback_slot` is a request, not a booking. A person confirms it. The dashboard must render the slot as pending until a human does.
- Outcomes other than `recovered` and `partial` post an outcome-only payload with no lead fields; see the table in [`result-schema.md`](result-schema.md).
- Keep the record on disk when the post fails, so `--post-dashboard` can retry it without another call.

## Credentials

- The webhook URL comes from the `CALLBACKOPS_DASHBOARD_URL` environment variable; the bearer token from `CALLBACKOPS_DASHBOARD_TOKEN`. Never pass either as a command-line argument, and never log them.
- Requests authenticate with `Authorization: Bearer $CALLBACKOPS_DASHBOARD_TOKEN`.
- Treat the webhook URL itself as a credential. Do not print it in dry-run output; the dry-run prints `dashboard: set (env)` or `dashboard: not set`.

## Retry Behavior

- The post is retried on connection errors and 5xx responses, with backoff, up to three times.
- 4xx responses other than 429 are not retried; they are surfaced as a blocker for the operator.
- A failed dashboard post never triggers another phone call. The phone call and the dashboard post have separate retry budgets.

## CallbackOps Reference Deployment

CallbackOps, the reference deployment this skill ships from, is live on Cloud Run:

- Agent endpoint: `https://callbackops-agent-1087493193698.us-west1.run.app`
- The deployment classifies a missed call or voicemail with Gemini, drafts the recovery reply, books or escalates, and exposes the missed-call ingestion endpoint that produces the events this skill consumes.

The skill is portable and does not depend on that deployment: any endpoint that can receive the payload above works as a dashboard webhook. The reference deployment's live outbound calling is pending the operator's CALL-E account activation; see the *Testing Status* section of [`SKILL.md`](../SKILL.md) before promising end-to-end behavior.

## Phone Masking

The mask keeps country code and last digits in a stable, non-reversible-in-log form:

```text
+15551230142 -> +1555****0142   (keep country+area shape, mask the middle)
```

- Mask before any write: logs, results file, dashboard payload, summaries.
- The mask is for display consistency only; suppression still requires the full E.164 number in the operator's own do-not-call store, keyed by hash, never by plaintext number.
