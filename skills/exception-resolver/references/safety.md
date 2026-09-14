# Safety Reference

Exception Resolver can initiate real-world phone calls. It must preserve explicit authorization and strict execution boundaries.

## Explicit Intent

Before placing a call, require explicit per-run intent identifying:

- the exception being resolved
- the operational purpose of the call
- the authorized person or role to contact
- the information the agent may request or disclose
- the expected resolution or decision
- whether the call may create an external side effect

Do not infer permission to call merely because an exception exists.

## Phone Numbers

Outbound phone numbers MUST use strict E.164 format.

Valid fictional example:

`+15550101234`

Reject local, punctuation-formatted, whitespace-formatted, or otherwise malformed numbers.

Mask phone numbers in user-facing output, normal logs, status summaries, and examples.

Example:

`+15550101234` → `+1******1234`

Never include real personal phone numbers in repository examples.

## Authorization and Consent

Call only an authorized contact for the stated operational purpose.

Do not disclose unnecessary sensitive information.

Do not expose credentials, API keys, tokens, cookies, or provider secrets.

A phone conversation alone does not prove identity, consent, authorization, or legal validity.

## Duplicate Calls

Before initiating a call, check for an existing active, pending, or recently completed call covering the same exception and operational intent.

If a duplicate exists:

- do not place another call
- preserve the existing result
- return a clear stopped/duplicate status
- require explicit new authorization before another call

## Ambiguous Outcomes

Never treat an ambiguous call outcome as successful resolution.

Ambiguous, incomplete, contradictory, interrupted, unavailable, refused, or failed outcomes must stop automated resolution.

Do not invent a resolution or automatically retry indefinitely.

Require human or explicitly authorized workflow review.

## Cancellation

A pending call must be cancellable before execution.

After cancellation:

- mark the workflow as cancelled
- do not automatically restart it
- preserve the cancellation state
- require explicit new authorization before another call

## High-Stakes Boundaries

Do not autonomously make or resolve calls involving:

- medical care or treatment decisions
- emergency response
- legal decisions or legal representation
- financial transactions or financial decisions
- safety-critical operational decisions
- identity or security verification where a phone call alone is insufficient
- disclosure of sensitive personal information without appropriate authorization

When high-stakes content is detected:

1. stop the automated workflow
2. do not make an unauthorized call
3. surface the issue to a human/operator
4. preserve the exception context
5. require explicit authorization before any permitted next action

## Human Approval

The phone conversation gathers information. It does not by itself authorize the final consequential resolution.

Keep final resolution decisions under human control when required.
