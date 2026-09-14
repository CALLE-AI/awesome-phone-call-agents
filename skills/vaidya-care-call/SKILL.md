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

Possible patient_reached values include:

yes
no
voicemail
wrong_number

Possible health_status values include:

improved
stable
worsened
unknown

The exact schema may vary by implementation.

Do not infer a successful health assessment when the patient was not reached.

Post-Call Processing

A completed call is not the end of the workflow.

After receiving the structured CALL-E result:

Store the call result.
Create exactly one patient event for the call outcome.
Associate the event with the call record.
Reassess the patient's longitudinal state.
Determine whether follow-up should be maintained, increased, escalated, or otherwise adjusted.
Surface cases requiring human attention to the healthcare worker.

Call-result processing must be idempotent.

If the same CALL-E result is received or processed more than once, the system must not create duplicate patient events or duplicate care actions.

Human Oversight

Automated routine follow-up should not be presented as replacing healthcare workers.

The purpose of this workflow is to reduce repetitive follow-up work while preserving human oversight for patients who require additional attention.

Urgent or clinically concerning situations should follow the application's escalation policy rather than being treated as ordinary automated follow-up calls.

A system may automate routine communication while keeping clinically significant escalation under human control.

Privacy

Do not place real patient information in source code, examples, tests, screenshots, or documentation.

Never publish:

real patient names
real patient phone numbers
medical records
API keys
authentication tokens
private database identifiers

Use synthetic or masked patient data in examples.

Example:

Patient: Example Patient
Phone: +91XXXXXXXXXX
Failure Handling

If CALL-E cannot initiate the call:

Record the failure.
Do not report that the patient was contacted.
Surface the failure to the appropriate healthcare workflow.
Retry only according to an explicit retry policy.

If the patient cannot be reached:

Record the actual outcome.
Do not interpret the failed contact as a successful health assessment.
Follow the application's retry or human-review policy.

If the call result is incomplete or ambiguous:

Preserve the uncertainty.
Do not invent missing clinical information.
Allow the healthcare workflow to determine whether human review is required.
Idempotency

Call initiation and result processing should be protected against duplicate execution.

A repeated callback, webhook, or processing attempt must not:

create duplicate patient events
create duplicate care decisions
initiate duplicate calls
overwrite a valid result with an older result

Use a stable call identifier or equivalent idempotency mechanism when available.

Auditability

A healthcare communication workflow should make it possible to determine why a call was made.

Record sufficient metadata to trace the action, including:

patient identifier
care decision identifier
call reason
risk level
priority
CALL-E call identifier
call status
timestamps
structured call outcome

Avoid storing unnecessary sensitive information.

Core Principle

The upstream healthcare agent may identify that a follow-up action is appropriate.

A deterministic safety layer decides whether an automated call is permitted.

CALL-E performs the communication action.

The call result becomes new information in the patient's longitudinal care timeline.

The healthcare workflow then reassesses the patient and determines what should happen next.

The goal is not simply to make a phone call.

The goal is to close the loop between patient information, care decisions, communication, and reassessment.


### Then do this

1. **Paste** it into `SKILL.md`.
2. Scroll to the bottom.
3. Commit message:

```text
Add Vaidya care call skill
