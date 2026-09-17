# Vaidya Care Call Examples

All examples use fake or masked data.

## Preview-Only Example

```text
Patient: CT-DEMO-102
Reason: worsening trajectory requires increased follow-up
Risk: high
Priority: high
Safety gate: PASS
Destination: +91••••••5837
Destination authorization: VALID

CALL PREVIEW
Live call: NOT STARTED
Operator approval: REQUIRED
```

No phone call occurs in this mode.

Approved Live Run
Patient: CT-DEMO-102
Safety gate: PASS
Destination: +91••••••5837
Destination authorization: VALID
Operator approval: APPROVED

CALL-E
Status: initiated
Call ID: call_demo_••••

The live run occurs only after explicit operator approval.

Blocked Safety Gate
Patient: CT-DEMO-104
Risk: moderate
Priority: normal
Safety gate: BLOCKED
Reason: automated-call threshold not satisfied

Live call: NOT STARTED

The workflow stops.

Unknown Outcome
Call ID: call_demo_••••
Provider status: UNKNOWN

Action:
STOP
DO NOT RETRY
DO NOT CREATE PATIENT EVENT
RECONCILE PROVIDER STATUS

No patient-reported outcome is created until the call reaches a verified terminal state.

Verified Call Result
{
  "patient_reached": "yes",
  "health_status": "stable",
  "symptoms": [],
  "medication_adherence": "partial",
  "urgent": false,
  "notes": "Patient reported no new concerns.",
  "next_action": "continue_followup"
}

Only information actually obtained during the call should be recorded.

Cancellation
Before Live Initiation
Operator approval: NOT GIVEN
Action: CANCEL
CALL-E call: NOT STARTED
After Provider Acceptance
Call ID: call_demo_••••
Provider status: accepted
Cancellation: provider-dependent
