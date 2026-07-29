# Examples

## Dry Run

```text
User: Brief the authorized manager about invoice exception INV-EX-104 and explain where to review it.

Agent:
status: planned
purpose: manager briefing for invoice exception INV-EX-104
recipient: verified manager, +1••• ••• 8435
callee confirmation: required before invoice context is disclosed; no voicemail or callback message
briefing: A factual, redacted exception summary and the secure human-review route.
decision authority: human review application only
side effect: one CALL-E call after confirmation
cancellation: available before provider acceptance; no retry after acceptance or outcome-unknown
```

## Confirmation and Result

```text
User: Confirm the one planned call.

Agent:
status: accepted
recipient: verified manager, +1••• ••• 8435
next step: The manager reviews and decides in the existing application.
```

If the callee does not positively confirm the verified manager role, the call ends without invoice context or a voicemail. The example uses a masked fictional phone number. It does not include a credential, real recipient, recording, voicemail, or transcript.
