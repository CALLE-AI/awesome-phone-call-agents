# Examples — insurance-call-recovery

All numbers below are fictional ITU-T/NANP test numbers. These examples do not place real calls.

## Claim status — recovered

```json
{
  "task_description": "Customer has not heard back on claim #CLM-88213.",
  "task_type": "claim_status",
  "destination": "+15555010199",
  "intended_outcome": "Get current claim status and next step.",
  "policy_or_claim_reference": "CLM-88213"
}
```

Preview:

```text
Task: Obtain claim status for CLM-88213
Party: Claims department
Destination: +1555•••0199
Mode: dry-run by default / live requires approval
```

Verified result:

```json
{
  "recovery_id": "irc_a1_clm88213",
  "status": "recovered",
  "intent": "claim_status",
  "task": "Obtain latest claim status",
  "party_contacted": "claims_department",
  "outcome": {
    "claim_status": "under_review",
    "next_action": "adjuster_review"
  },
  "evidence": {"source": "phone_call", "verified": true},
  "confidence": "high",
  "human_escalation_required": false
}
```

## Billing — recovered

```json
{
  "task_description": "Customer disputes a charge on the March billing cycle.",
  "task_type": "billing",
  "destination": "+15555010212",
  "intended_outcome": "Confirm whether the disputed charge was reviewed and the resolution."
}
```

A billing representative explicitly confirms the review and resolution. Only fields stated by the representative are populated.

## Renewal — ambiguous

```json
{
  "task_description": "Policy renews soon and the customer has not confirmed intent.",
  "task_type": "renewal",
  "destination": "+15555010233",
  "intended_outcome": "Confirm renewal intent: renew, decline, or needs more information."
}
```

If the contact says they are still considering it without choosing an outcome:

```json
{
  "status": "ambiguous",
  "outcome": {"renewal_decision": "undetermined"},
  "evidence": {"source": "phone_call", "verified": false},
  "confidence": "low",
  "human_escalation_required": true
}
```

## Policy service — no answer

```json
{
  "task_description": "Customer requested an address change and never received confirmation.",
  "task_type": "policy_service",
  "destination": "+15555010244",
  "intended_outcome": "Confirm whether the requested change was applied."
}
```

No answer produces `no_answer`; it does not produce `recovered` and does not trigger an automatic redial.

## Dry-run

```bash
python -m insurance_call_recovery.cli --input examples/claim.json --dry-run
```

Dry-run returns the same structured result shape as live execution with `"mode": "dry_run"` and never invokes the live call operation.
