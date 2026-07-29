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
- make a decision, promise payment, or imply that a decision has been made
- read full invoice contents, payment data, personal data, credentials, or unrestricted audit history over the phone
- create recurring calls, retries, reminders, or background schedules
- retry a call after failure without a new explicit request
- use a browser-delivered API key or expose provider credentials

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
3. Build a redacted briefing that states only the factual exception summary, what the manager should review, and the human decision route. Do not include secrets, full payment details, or personal data.
4. Produce a dry-run plan by default. Show a masked destination, the call purpose, the human review route, and the cancellation control.
5. Before dispatch, confirm that the kill switch is off, the call has not already been sent for the same idempotency key, and the destination matches the verified manager.
6. Dispatch one CALL-E call only after the user confirms the plan.
7. Report a minimal result: requested, accepted, delivered, or failed. Do not retain or repeat voicemail or call-transcript content unless separately authorized and policy permits it.
8. Direct the manager to the existing review application. Keep all decisions and immutable decision evidence there.

## Idempotency, Cancellation, and Failure

- Use an idempotency key bound to the exception, recipient, and call purpose.
- Return the original result for an exact replay; reject a changed request that reuses the key.
- Treat the kill switch as a hard stop before dispatch.
- If cancellation is requested before dispatch, do not place the call and report `cancelled`.
- If provider authentication, recipient verification, or any scope check fails, do not call.
- A failed or unanswered call does not authorize an automatic retry. Require a new explicit user request.

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
