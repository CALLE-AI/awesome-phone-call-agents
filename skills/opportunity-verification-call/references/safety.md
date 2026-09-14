# Safety & Governance

## Explicit User Intent & Preview
Real-call execution requires explicit user intent. The system exposes its outbound-call side effect before execution, supporting a no-call preview path. Users must review the bounded questions and the target contact before a call is explicitly approved. There are no hidden recurring schedules or autonomous call loops.

## E.164 Validation & Masking
All input phone numbers must be strictly validated against the E.164 format before a call is scheduled. Phone numbers and sensitive credentials must be masked in logs, telemetry, and terminal outputs. No real user phone numbers should be committed in PRs, fixtures, or demo overlays.

## Duplicate-Call Prevention
The skill enforces a lock/idempotency token on the opportunity ID and contact number to prevent duplicate or runaway calls to the same business for the same verification task.

## Cancellation & Ambiguous State
If the provider state is ambiguous (e.g., call drops, network failure, or API timeout), the call task is marked as `UNKNOWN` rather than success or definitive failure. The system must gracefully handle inflight cancellation requests and surface the partial state to the downstream truth-reconciliation layer.

## High-Stakes Boundaries
This skill is strictly bounded to verifying public employment/gig details. It must explicitly reject instructions to extract medical, legal, financial, or emergency content, and it must not attempt to negotiate terms, make payments, or formally accept offers on behalf of the user.