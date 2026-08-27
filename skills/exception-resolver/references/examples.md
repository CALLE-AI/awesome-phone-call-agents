# Exception Resolver Examples

## Safe Call

Exception: EX-1042

Purpose: Confirm a revised delivery date with an authorized carrier representative.

The agent has explicit per-run intent, confirms the contact is authorized, and uses the fictional E.164 number `+15550101234`.

The call proceeds only after all required safety checks pass.

The result is presented for human approval before the exception is resolved.

The phone number is masked in normal output as `+1•••••••1234`.

## Invalid Phone Number

Input:

`415-555-0123`

Expected result:

- Reject the number.
- Do not place the call.
- Return a validation error requiring strict E.164 format.

The agent must not silently reformat the number.

## Missing Intent

An exception exists, but there is no explicit operational purpose for the call.

Expected result:

- Do not place the call.
- Return a stopped/rejected status.
- Require explicit per-run intent.

## Duplicate Call

An active or recently completed call already covers the same exception and operational purpose.

Expected result:

- Do not place another call.
- Preserve the existing result.
- Return a duplicate/stopped status.
- Require explicit new authorization before another call.

## Ambiguous Outcome

The call ends with incomplete, contradictory, interrupted, or otherwise uncertain information.

Expected result:

`CALL-E call → ambiguous outcome → STOP → exception remains unresolved → human review`

The agent must not invent a resolution or automatically retry the call.

## Cancellation

A pending call is cancelled before execution.

Expected result:

`authorized workflow → cancellation → CANCELLED → no automatic restart`

A new call requires explicit authorization.

## High-Stakes Content

The exception involves a medical, emergency, legal, financial, safety-critical, or otherwise high-stakes decision.

Expected result:

`high-stakes content detected → STOP → human/operator review`

The agent must not autonomously make or resolve the consequential decision.

## Successful Structured Result

```json
{
  "exception": "EX-1042",
  "information_gathered": [
    "Carrier confirmed delivery delay of one day"
  ],
  "call_outcome": "success",
  "proposed_resolution": "Update expected delivery date",
  "confidence": "high",
  "human_approval_required": true,
  "human_approval_status": "pending",
  "next_action": "Request human approval"
}
