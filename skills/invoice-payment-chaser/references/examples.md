# Invoice Payment Chaser Examples

## Safe Call

Invoice: INV-1111, CNY 6,293,346.22, 105 days overdue against the buyer's
own historical average of ~40 days across 34 prior payments.

The agent has explicit per-run intent (invoice, amount, days overdue,
buyer's learned pattern), confirms the contact is the buyer's authorized
billing representative, and calls the fictional/reserved E.164 sample
number `+15550101234`.

The call proceeds only after all required safety checks pass. The result
is presented for human/reconciliation review before the invoice status is
updated. The phone number is masked in normal output as `+1•••••••1234`.

## Invalid Phone Number

Input:

`415-555-0123`

Expected result:

- Reject the number.
- Do not place the call.
- Return a validation error requiring strict E.164 format.

The agent must not silently reformat the number.

## Missing Intent

An invoice is overdue, but there is no explicit call goal or buyer payment
profile supplied for the run.

Expected result:

- Do not place the call.
- Return a stopped/rejected status.
- Require explicit per-run intent, including the buyer's learned payment
  pattern used to calibrate tone.

## Duplicate Call

An active or recently completed call already covers the same invoice within
the same chase cycle.

Expected result:

- Do not place another call.
- Preserve the existing result.
- Return a duplicate/stopped status.
- Require explicit new authorization before another call.

## Ambiguous Outcome

The call ends with a vague, non-committal, or contradictory answer about
payment status — no confirmed date and no specific reason for delay.

Expected result:

`CALL-E call → ambiguous outcome → STOP → invoice remains unresolved → human review`

The agent must not invent a resolution, assume payment, or automatically
retry the call.

## Cancellation

A pending call is cancelled before execution (e.g. the invoice was paid in
the interim, matched during the next reconciliation pass).

Expected result:

`authorized workflow → cancellation → CANCELLED → no automatic restart`

A new call requires explicit new authorization.

## High-Stakes Content

The call attempts to negotiate a settlement amount, accept a payment
instrument, or threaten legal/collections action.

Expected result:

`high-stakes content detected → STOP → human/operator review`

The agent must not autonomously negotiate terms, accept payment, or make
legal/collections threats — it only gathers and reports the buyer's stated
status.

## Successful Structured Result

Real result from a live test call (transcript and video available at
https://github.com/thanawinhvh/gotpaid):

```json
{
  "invoice_id": "INV-1111",
  "amount": 6293346.22,
  "currency": "CNY",
  "days_overdue": 105,
  "buyer_usual_lag_days": 40.4,
  "outcome": "confirmed_date",
  "confirmed_payment_date": "2026-09-20",
  "confidence": 0.95,
  "human_approval_required": true,
  "human_approval_status": "pending",
  "next_action": "Reconcile against the next matching bank deposit"
}
```
