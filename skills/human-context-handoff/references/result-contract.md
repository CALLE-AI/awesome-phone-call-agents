# Result Contract

This contract is provider-portable. Adapters may include additional fields, but
they must preserve the acknowledgement, polling, and fail-closed rules below.

## Durable acknowledgement

A live submission succeeds only after the request is durably stored and its
asynchronous call job is queued.

```json
{
  "request_id": "req_example_01",
  "status": "queued",
  "message": "The handoff was accepted and is preparing the call.",
  "poll_after_seconds": 10,
  "status_operation": "get_status"
}
```

The acknowledgement is not a human answer. Missing `request_id`, an unknown
status, or an acknowledgement received after a transport timeout is an
ambiguous provider state. Reconcile it by idempotency key instead of submitting
again.

## Progress states

An adapter may expose detailed milestones such as `accepted`, `queued`,
`call_starting`, `ringing`, `human_answered`, `conversation_active`, and
`decision_processing`. These states are nonterminal and must not select an
agent action.

Every status response should contain:

- the current status;
- a concise message;
- the last-update timestamp;
- whether the state is terminal;
- the recommended polling interval;
- a structured decision only when completed;
- safe error and retry information when failed.

## Terminal result

```json
{
  "request_id": "req_example_01",
  "status": "completed",
  "choice": "guided_test",
  "rationale": "Let the user hear the product before configuring it.",
  "constraints": ["Show call settings immediately afterward"],
  "answered_by": "enrolled_human",
  "last_updated_at": "2030-01-15T09:30:00Z",
  "terminal": true
}
```

Required validation for `completed`:

1. `request_id` matches the stored request.
2. `terminal` is `true`.
3. `choice` exactly matches one previewed choice ID.
4. `rationale` and `constraints` contain no secrets and do not expand the
   previewed authority.
5. The result belongs to the current account and logical question.

Closed terminal statuses are `completed`, `unanswered`, `declined`, `expired`,
`cancelled`, and `failed`. Unknown terminal values fail closed.

## Failure result

```json
{
  "request_id": "req_example_04",
  "status": "failed",
  "message": "The call outcome could not be confirmed.",
  "last_updated_at": "2030-01-15T10:15:00Z",
  "terminal": true,
  "error": {
    "code": "provider_state_unknown",
    "retryable": false,
    "retry_after_seconds": null
  }
}
```

A failure never implies that no call happened. Do not retry until the provider
state and idempotency identity have been reconciled.
