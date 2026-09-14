# Examples

## Example 1: Authorized Follow-Up

A patient has a worsening health trajectory, and the healthcare system determines that an increased follow-up is appropriate.

Before initiating the call, the application verifies that:

- An authorized phone number exists.
- The care decision permits an automated follow-up call.
- The patient satisfies the configured risk threshold.
- The patient satisfies the configured priority threshold.
- The call is associated with the intended patient.
- The same call has not already been initiated.

The deterministic safety gate passes.

The server then initiates the CALL-E call.

The system records the CALL-E call identifier, reason, status, and relevant care-decision metadata.

After the call is completed, the structured result is stored and becomes a new patient event. The patient's longitudinal state is then reassessed.

## Example 2: Safety Gate Rejection

A healthcare agent recommends contacting a patient, but the deterministic safety gate determines that the patient does not satisfy the configured requirements for an automated call.

For example, the patient's risk level or priority may be below the application's automated-call threshold.

The call must not be initiated.

The recommendation can instead be surfaced to the appropriate healthcare worker for review.

The language model recommendation must never override the deterministic safety decision.

## Example 3: Patient Not Reached

CALL-E attempts the follow-up call, but the patient does not answer.

The system records the actual outcome:

```json
{
  "patient_reached": "no",
  "health_status": "unknown",
  "urgent": false
}

The system must not interpret the failed contact as a successful health assessment.

The application's retry or human-review policy determines the next step.

Example 4: Voicemail

CALL-E reaches voicemail instead of the patient.

The system records the outcome as:

{
  "patient_reached": "voicemail",
  "health_status": "unknown",
  "urgent": false
}

No clinical conclusion should be inferred from the voicemail outcome.

Any retry or follow-up action must follow the application's communication policy.

Example 5: Worsening During Follow-Up

The patient answers the call and reports that their symptoms have worsened.

The structured result records the worsening status:

{
  "patient_reached": "yes",
  "health_status": "worsened",
  "urgent": false
}

The result becomes a new patient event.

The longitudinal care workflow then reassesses the patient and determines whether increased follow-up, human review, or escalation is appropriate.

Example 6: Urgent Concern

During the follow-up call, the patient reports a concerning situation that requires human attention.

The result should preserve the urgent finding:

{
  "patient_reached": "yes",
  "health_status": "worsened",
  "urgent": true
}

The system should not treat this as an ordinary routine follow-up outcome.

The result should enter the application's escalation or human-review workflow.

The automated communication layer must not independently make a clinical diagnosis.

Example 7: Idempotent Result Processing

CALL-E sends a completion result more than once because of a retry or duplicate callback.

The application recognizes that the CALL-E call identifier has already been processed.

The system must not create another patient event or another care action.

For example:

First processing:
CALL-E result
    ↓
CallRecord updated
    ↓
PatientEvent created
    ↓
Reassessment triggered

Duplicate processing:
CALL-E result
    ↓
Already processed
    ↓
No duplicate PatientEvent
    ↓
No duplicate care action

This prevents duplicate events and unintended repeated actions.

Example 8: Synthetic Call Data

Examples and documentation must never contain real patient contact information.

Use synthetic or masked values:

Patient: Example Patient
Phone: +91XXXXXXXXXX

Do not include real patient names, phone numbers, medical records, API keys, authentication tokens, or private database identifiers in examples.

Example 9: Complete Care Loop

A complete workflow can be represented as:

Patient health event
        ↓
Longitudinal assessment
        ↓
Care decision
        ↓
Deterministic safety gate
        ↓
CALL-E call
        ↓
Structured call outcome
        ↓
Patient event
        ↓
Longitudinal reassessment
        ↓
Next care decision

The purpose of the workflow is to connect patient information, care decisions, communication, and reassessment rather than treating the phone call as the final step.
