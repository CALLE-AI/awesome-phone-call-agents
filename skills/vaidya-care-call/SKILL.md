---
name: vaidya-care-call
description: Safe patient follow-up calling workflow for community healthcare systems using CALL-E. Use when a healthcare agent needs to place an authorized follow-up call, enforce deterministic safety checks, collect structured patient-reported outcomes, and feed the result back into care reassessment.
---

# Vaidya Care Call

A safety-first workflow for using CALL-E to perform routine patient follow-up calls in community healthcare systems.

This skill is designed for systems where an upstream healthcare agent has already analyzed a patient's longitudinal health information and produced a structured care decision.

## Workflow

Follow this sequence:

1. Observe the patient's latest structured health event.
2. Review relevant longitudinal patient history.
3. Determine the patient's current risk level and priority.
4. Produce a structured care decision.
5. Run a deterministic safety gate before any automated call.
6. If the call is authorized, initiate the CALL-E call using the patient's authorized phone number.
7. Track the call lifecycle.
8. Convert the call result into structured health information.
9. Store the result as a patient event.
10. Reassess the patient's condition and determine the next action.

The phone call is an action within the care workflow, not the end of the workflow.

## Safety Gate

Never allow a language model alone to authorize an automated healthcare call.

Before initiating a call, verify all required conditions:

- An authorized patient phone number exists.
- The care decision explicitly permits a routine follow-up call.
- The patient's risk level satisfies the application's automated-call threshold.
- The patient's priority satisfies the application's automated-call threshold.
- The call reason is traceable to a structured care decision.
- The call is associated with the correct patient record.
- The same call has not already been initiated.

If any required condition fails, do not initiate the call.

Do not bypass or weaken the safety gate because a model recommends calling.

## Call Initiation

Phone numbers should be stored and supplied in E.164 format.

CALL-E API credentials must remain server-side and must never be exposed to:

- browser code
- frontend applications
- client-side environment variables
- logs
- screenshots
- public repositories
- documentation

Only initiate a call after the deterministic safety gate has passed.

The system should record:

- patient identifier
- call reason
- care decision identifier
- risk level
- priority
- call timestamp
- CALL-E call identifier
- call status

## Patient Conversation

The follow-up call should be concise and focused on collecting information relevant to the existing care decision.

The caller should:

1. Identify the healthcare service appropriately.
2. Confirm that the patient is available to talk.
3. Explain the reason for the follow-up.
4. Ask whether relevant symptoms have improved, remained stable, or worsened.
5. Ask about medication adherence when applicable.
6. Identify urgent concerns.
7. Record the patient's responses.
8. Avoid making unsupported medical diagnoses.

The caller should not claim to be a doctor or replace professional medical judgment.

The conversation should collect patient-reported information rather than attempting to independently diagnose the patient.

## Structured Outcome

Convert the completed call into structured information.

A result may contain fields such as:

```json
{
  "patient_reached": "yes",
  "health_status": "stable",
  "symptoms": [],
  "medication_adherence": "partial",
  "urgent": false,
  "notes": "",
  "next_action": "continue_followup"
}
