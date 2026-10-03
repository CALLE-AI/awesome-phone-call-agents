# Safety & Governance

## Explicit User Intent & Preview
Real-call execution requires explicit user intent. The host must expose the outbound-call side effect in a no-call preview. Users must review the bounded questions and authorize the target contact before approving this one call. This reference supplies no executable host integration; hosts must not add hidden recurring schedules or autonomous call loops.

## E.164 Validation & Masking
All input phone numbers must be strictly validated against the E.164 format before a call is scheduled. Phone numbers and sensitive credentials must be masked in logs, telemetry, and terminal outputs. No real user phone numbers should be committed in PRs, fixtures, or demo overlays.

## Duplicate-Call Prevention
Duplicate prevention is a host responsibility, not an implemented lock in this skill. The host must track the approved opportunity/contact intent and use a stable provider idempotency key where supported. Do not submit another call while that intent is pending or unknown; a new invocation is not evidence that the previous call failed.

## Cancellation & Ambiguous State
If the provider state is ambiguous (e.g., call drops, network failure, or API timeout), the host must mark the task `UNKNOWN`, stop automatic redial and conflicting downstream actions, and ask a person to reconcile the existing call. Do not convert ambiguity into success or definitive failure.

Cancel before submission by discarding the pending intent. After provider acceptance, stopping the host or withdrawing approval may not stop the call. Use a supported provider cancellation action only when available, report its actual result, and otherwise state that the accepted call may continue. This skill implements neither cancellation infrastructure nor a durable state store.

## High-Stakes Boundaries
This skill is strictly bounded to verifying public employment/gig details. It must explicitly reject instructions to extract medical, legal, financial, or emergency content, and it must not attempt to negotiate terms, make payments, or formally accept offers on behalf of the user.
