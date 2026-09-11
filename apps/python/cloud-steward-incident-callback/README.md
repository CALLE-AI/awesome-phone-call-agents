# Cloud Steward Incident Callback

Turn a Cloud Steward incident plan into one consent-first CALL-E notification for an enrolled on-call owner.

This app is an **incident notification**, not remote approval. A call can report context and ask the recipient to choose `acknowledged`, `review_now`, or `unknown`. Every result keeps `actionRemainsPending: true`; a phone response cannot approve or execute an infrastructure plan.

## Side effects

- Preview mode is the default and makes no network request.
- Live mode can place exactly one outbound phone call through the official `calle` CLI.
- The recipient must have explicitly consented to operational incident calls.
- The request ID is used as an idempotency key in the local audit file.
- Do not use this app for emergencies, unknown third parties, destructive approval, or medical, legal, or financial decisions.

## Input

Create a JSON file using a fictional reserved number for tests:

```json
{
  "requestId": "incident-2026-08-02-001",
  "severity": "high",
  "service": "checkout-api",
  "summary": "Elevated checkout latency; invoice generation remains healthy.",
  "contextUrl": "https://cloud-steward.onrender.com",
  "planId": "plan-demo-001",
  "recipient": {
    "phone": "+15550102020",
    "relationship": "consenting on-call owner",
    "consentRecordedAt": "2026-08-02T00:00:00Z"
  }
}
```

Required constraints:

- `requestId` must be unique and non-empty.
- `severity` must be `high` or `critical`.
- `service` and `summary` must be short, redacted labels without credentials.
- `recipient.phone` must use E.164 format.
- `relationship` must be exactly `consenting on-call owner`.
- `consentRecordedAt` must be an ISO 8601 timestamp.

## Preview first

```bash
python incident_callback.py preview \
  --request incident.json \
  --audit incident-callbacks.jsonl
```

The preview prints the masked destination and exact call goal. It does not invoke `calle` and does not append a live-call audit record.

## Live call

Install and authenticate the official CALL-E CLI first. Then explicitly confirm this exact request:

```bash
export CALLE_LIVE_CONFIRMATION=CALL_ON_CALL_ONCE

python incident_callback.py call \
  --request incident.json \
  --audit incident-callbacks.jsonl \
  --calle-command calle
```

The app runs this shape:

```text
calle auth status -> calle call plan -> inspect target -> calle call run -> calle call status
```

The app preserves `plan_id` and `confirm_token` only in process memory. It does not print or write tokens, credentials, complete phone numbers, or transcripts.

## Cancellation and uncertainty

- Before `call run`, cancel by not setting the literal confirmation or by stopping after preview.
- After `call run`, use the provider-supported cancellation route if one is returned. The current CLI reference does not expose a generic cancel command.
- If provider state is unknown, do not retry. Record `unknown`, keep the action pending, and reconcile the call ID with an operator.
- A rejection or `unknown` response ends this attempt. Do not call again to obtain a different answer.

## Test

```bash
python -m unittest discover -s tests -v
```

Tests use a fake CLI and place no calls.

## Output contract

```json
{
  "requestId": "incident-2026-08-02-001",
  "maskedPhone": "+1*******020",
  "callId": "provider-run-id-or-null",
  "decision": "acknowledged | review_now | unknown",
  "actionRemainsPending": true
}
```
