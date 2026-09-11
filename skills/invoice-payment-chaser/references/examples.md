# Invoice Payment Chaser Examples

## Safe Call

Invoice: INV-1111, CNY 6,293,346.22, 105 days overdue against the buyer's
own historical average of ~40 days across 34 prior payments.

The agent has explicit per-run intent (invoice, amount, days overdue,
buyer's learned pattern), confirms the contact is the buyer's authorized
billing representative, and calls the fictional/reserved E.164 sample
number `+12025550123`.

The call proceeds only after all required safety checks pass. The result
is presented for human/reconciliation review before the invoice status is
updated. The phone number is masked in normal output as `+1•••••••0123`.

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

Illustrative structured result (synthetic invoice, no real call/contact
data):

```json
{
  "invoice_id": "INV-0001",
  "amount": 125000.00,
  "currency": "USD",
  "days_overdue": 60,
  "buyer_usual_lag_days": 20.0,
  "outcome": "confirmed_date",
  "confirmed_payment_date": "2026-10-01",
  "confidence": 0.9,
  "human_approval_required": true,
  "human_approval_status": "pending",
  "next_action": "Reconcile against the next matching bank deposit"
}
```
