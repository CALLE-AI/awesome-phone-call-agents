# Proposal contract

The host may use its own persistence format, but the proposal needs these
fields:

```json
{
  "action": "call_task",
  "title": "Call Alex to confirm the delivery window",
  "rationale": "The email asks for a phone confirmation before Friday.",
  "source": {
    "kind": "calendar_event",
    "id": "calendar:event_123",
    "title": "Hair appointment",
    "url": "https://calendar.google.com/event/example"
  },
  "payload": {
    "recipientName": "Maya's Hair Studio",
    "phone": "+14155550101",
    "region": "US",
    "locale": "en-US",
    "goal": "Ask whether the hair appointment can move from Friday at 3 PM to Saturday at 11 AM.",
    "originalChannel": "phone",
    "resultSchema": {
      "type": "object",
      "required": ["outcome"],
      "properties": {
        "outcome": {
          "type": "string",
          "enum": ["confirmed", "needs_reschedule", "declined", "no_answer", "unclear"]
        },
        "requestedNewTime": {"type": ["string", "null"]}
      }
    }
  }
}
```

The host must preserve the source reference and proposal id when it calls
CALL-E. Use the proposal id as the idempotency key so a retried approval does
not create duplicate calls.

The execution result should preserve:

```json
{
  "callId": "call_123",
  "status": "completed",
  "taskCompleted": true,
  "summary": "The recipient confirmed the Friday window.",
  "structuredResult": {
    "outcome": "confirmed",
    "requestedNewTime": null
  }
}
```
