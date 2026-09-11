# Safety Reference

Invoice Payment Chaser can initiate real-world phone calls to a buyer's
billing contact. It must preserve explicit authorization and strict
execution boundaries.

## Explicit Intent

Before placing a call, require explicit per-run intent identifying:

- the invoice being chased (id, amount, currency, days overdue)
- the buyer's own learned payment pattern, so the call's tone is calibrated
  rather than generic
- the authorized billing/AP contact to call
- the information the agent may request or disclose
- the two acceptable resolutions: a confirmed payment date, or a specific
  stated reason for the delay

Do not infer permission to call merely because an invoice is overdue.

## Phone Numbers

Outbound phone numbers MUST use strict E.164 format.

Valid fictional example:

`+12025550123`

Reject local, punctuation-formatted, whitespace-formatted, or otherwise
malformed numbers.

Mask phone numbers in user-facing output, normal logs, status summaries,
and examples.

Example:

`+12025550123` → `+1•••••••0123`

Never include real personal phone numbers in repository examples.

## Authorization and Consent

Call only an authorized billing/accounts-payable contact at the buyer for
the stated invoice.

Do not disclose unnecessary sensitive information (e.g. other customers'
invoices or balances).

Do not expose credentials, API keys, tokens, cookies, or provider secrets.

A phone conversation alone does not prove identity, consent, authorization,
or legal validity.

## Duplicate Calls

Before initiating a call, check for an existing active, pending, or
recently completed call covering the same invoice within the same chase
cycle.

If a duplicate exists:

- do not place another call
- preserve the existing result
- return a clear stopped/duplicate status
- require explicit new authorization before another call

## Ambiguous Outcomes

Never treat an ambiguous call outcome as a confirmed payment date.

Ambiguous, incomplete, contradictory, interrupted, unavailable, refused, or
failed outcomes must stop automated resolution.

Do not invent a payment date or reason, and do not automatically retry
indefinitely.

Require human or reconciliation-workflow review.

## Cancellation

A pending call must be cancellable before execution (e.g. the invoice was
matched to a deposit in the interim).

After cancellation:

- mark the workflow as cancelled
- do not automatically restart it
- preserve the cancellation state
- require explicit new authorization before another call

## High-Stakes Boundaries

Do not autonomously make or resolve calls involving:

- negotiating, waiving, or altering payment terms
- accepting a payment or payment instrument over the call
- legal or collections decisions, or threatening legal/collections action
- identity or security verification where a phone call alone is
  insufficient
- disclosure of sensitive personal or financial information without
  appropriate authorization

When high-stakes content is detected:

1. stop the automated workflow
2. do not negotiate, accept payment, or make legal/collections threats
3. surface the issue to a human/operator
4. preserve the invoice and call context
5. require explicit authorization before any permitted next action

## Human Approval

The phone conversation gathers a payment status. It does not by itself
authorize the final consequential resolution (write-off, escalation, legal
referral).

Keep final resolution decisions under human control.
