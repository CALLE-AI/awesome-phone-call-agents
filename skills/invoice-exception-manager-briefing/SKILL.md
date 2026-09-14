---
name: invoice-exception-manager-briefing
description: Prepare a controlled, one-time CALL-E briefing for an authorized manager about an invoice exception, while keeping the human decision in the existing review application.
license: MIT
---

# Invoice Exception Manager Briefing

Use this skill when an authorized user wants CALL-E to give a manager a short, controlled explanation of an invoice exception and direct that manager to the existing web review path.

This is a communication skill, not a decision, payment, approval, or workflow-execution skill. The manager makes every decision in the existing application. CALL-E must not approve, reject, defer, escalate, change status, consume authority, create an audit record, or trigger downstream work.

## When To Use

Use this skill only when all of the following are available:

- an explicit user request for one manager briefing call
- an authorized manager recipient with a verified role and E.164 destination number
- a single named invoice exception that the recipient is allowed to review
- an existing human decision route, such as a secure web review page
- a provider credential stored outside source control

## When Not To Use

Do not use this skill to:

- call automatically after an exception is created
- call a requester, vendor, customer, or unverified third party
- disclose invoice context to a callee who has not positively confirmed that they are the verified manager
- leave a voicemail, call-back message, or invoice-specific message when a person does not answer or cannot confirm their role
- make a decision, promise payment, or imply that a decision has been made
- read full invoice contents, payment data, personal data, credentials, or unrestricted audit history over the phone
- create recurring calls, retries, reminders, or background schedules
- retry a call after failure without a new explicit request
- use a browser-delivered API key or expose provider credentials
- provide medical, legal, or emergency advice, triage, or response; direct an emergency caller to local emergency services instead

## Required Inputs

Require and verify these fields before creating a call plan:

- `managerId` and verified manager role
- `phoneNumber` in E.164 format
- tenant, workspace, and scope bindings
- an invoice-exception identifier and a redacted, factual briefing summary
- the existing human review route
- a user-provided reason for placing this call now
- a kill-switch or explicit cancellation control

Do not infer the recipient, phone number, role, tenant, workspace, scope, amount, or reason from unrelated context.

## Safe Workflow

1. Confirm explicit user intent for exactly one call.
2. Verify the manager role and tenant, workspace, and scope against the exception.
3. At the start of a live call, disclose no invoice context. Ask the callee to positively confirm that they are the verified manager before continuing. If they cannot confirm, the call reaches voicemail, or the response is ambiguous, end the call without leaving a message or disclosing the exception.
4. Build a redacted briefing that states only the factual exception summary, what the confirmed manager should review, and the human decision route. Do not include secrets, full payment details, or personal data.
5. Produce a dry-run plan by default. Show a masked destination, the call purpose, the human review route, and the cancellation control.
6. Before dispatch, confirm that cancellation is available and not requested, the call has not already been reserved for the same idempotency key, and the destination matches the verified manager.
7. Atomically create a durable reservation for the idempotency key before provider dispatch. Dispatch one CALL-E call only after the user confirms the plan.
8. Report a minimal result: requested, accepted, delivered, failed, cancelled, or outcome-unknown. Do not retain or repeat voicemail or call-transcript content unless separately authorized and policy permits it.
9. Direct the manager to the existing review application. Keep all decisions and immutable decision evidence there.

## Idempotency, Cancellation, and Failure

- Use an idempotency key bound to the exception, recipient, call purpose, and canonical request content.
- Store a durable, atomic reservation and result record for that key before dispatch. Concurrent exact requests must reuse the same reservation; a changed request that reuses the key must be rejected.
- Treat a provider timeout or ambiguous provider response as `outcome-unknown`. Reuse the same key and reconcile the original attempt; never issue a new-key retry unless the original attempt is confirmed absent.
- Keep the cancellation control armed and available for every planned call. Dispatch is allowed only while it is not cancelled. A cancellation request before provider acceptance must prevent dispatch and report `cancelled`.
- Provider acceptance is the point of no return for this skill. After acceptance, do not issue another call or retry. If the provider supports cancellation, request it through the same server-side operation and report only the provider-safe outcome; do not promise that an accepted call can be stopped.
- If provider authentication, recipient verification, or any scope check fails, do not call.
- A failed, unanswered, unconfirmed, or provider-rejected call does not authorize an automatic retry. Require a new explicit user request after the original attempt has a known terminal outcome.

## Off-Topic Safety Boundaries

- Do not use this skill for medical, legal, or emergency advice, triage, or response.
- If a callee raises an emergency, end the workflow without collecting additional sensitive information and direct them to local emergency services or the appropriate emergency contact.
- If a callee asks for legal or medical guidance, state that the call cannot provide that guidance and direct them to a qualified professional or the existing human review route when relevant.

## Credential and Phone Safety

- Keep `CALLE_API_KEY` or equivalent provider credentials in a server-side secret mechanism only.
- Never place credentials, full phone numbers, account emails, call recordings, or transcripts in source control, pull requests, logs, or user-facing summaries.
- Mask phone numbers in plans and reports, for example `+1••• ••• 8435`.
- Permit the browser only to request a user-approved briefing through a credential-free application boundary; the server-side bridge may allow only the official CALL-E endpoint.

## Output Format

Before a call, return:

```text
status: planned
purpose: manager briefing for an invoice exception
recipient: verified manager, +1••• ••• 8435
decision authority: human review application only
side effect: one CALL-E call after confirmation
cancellation: kill switch or explicit cancel before dispatch
```

After a call, return only the minimum provider-safe status and the next human-review step. Never claim that a business decision occurred merely because a briefing call was delivered.
