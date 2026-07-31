# Examples

These examples use reserved fictional phone numbers and redacted project data.
They do not authorize a live call.

## Preview Only

Input:

```json
{
  "requestId": "risk-event-2026-001",
  "eventKind": "blocked_destructive_action",
  "riskLevel": "extreme",
  "workspaceLabel": "commerce-demo",
  "actionSummary": "A recursive deletion request was blocked before execution.",
  "recipient": {
    "phone": "+15550102020",
    "relationship": "consenting project owner",
    "consentRecordedAt": "2026-01-01T00:00:00Z"
  },
  "secretValues": []
}
```

Expected preview summary:

```text
status: previewed
recipient: +1******2020
networkRequestMade: false
task: Tell the project owner that a recursive deletion request for
commerce-demo was blocked before execution. Ask whether the workflow should
stay stopped or be opened for normal local review later. The call cannot
approve or execute the action.
requiredConfirmation: CALL_OWNER_ONCE
```

Do not place a call unless the user provides the exact confirmation for this
preview.

## Constrained Live Result

After explicit confirmation and one successful CALL-E request, report only the
constrained result:

```json
{
  "requestId": "risk-event-2026-001",
  "callId": "call_example_001",
  "recipient": "+1******2020",
  "decision": "approve_after_review",
  "providerStatus": "completed",
  "actionRemainsBlocked": true
}
```

The next step is to notify the user that the ordinary local review flow may be
opened. Do not run, rewrite, or approve the blocked action.

## Unknown Or Wrong Recipient

If the provider times out, reaches voicemail, another person answers, the
response is ambiguous, or the provider state cannot be reconciled, use:

```json
{
  "requestId": "risk-event-2026-001",
  "callId": "call_example_001",
  "recipient": "+1******2020",
  "decision": "unknown",
  "providerStatus": "unknown",
  "actionRemainsBlocked": true
}
```

Do not retry the same idempotency key to seek a different answer.
