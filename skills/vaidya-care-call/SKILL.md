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
5. Run the deterministic safety gate.
6. Generate a no-call preview.
7. Stop for operator approval before any live call.
8. If explicitly approved, validate the authorized destination and initiate the CALL-E call.
9. Track the call lifecycle.
10. Convert a verified terminal call result into structured health information.
11. Store the verified result as a patient event when appropriate.
12. Reassess the patient's condition and determine the next action.

The phone call is an action within the care workflow, not the end of the workflow.

For detailed safety rules and examples, see:

- `references/safety.md`
- `references/examples.md`

## No-Call Preview

The default workflow is preview-only.

Before any live call, produce a preview containing:

- patient identifier or masked patient identifier
- reason for the proposed call
- care decision
- risk level
- priority
- deterministic safety-gate result
- destination authorization status
- proposed next action

The preview must not initiate a phone call.

A preview should use masked destinations and identifiers in logs and displayed output.

Example:

```text
CALL PREVIEW
Patient: CT-102
Reason: increased follow-up due to worsening trajectory
Risk: high
Priority: high
Safety gate: PASS
Destination: +91••••••5837
Destination authorization: VALID
Live call: NOT STARTED
Operator approval: REQUIRED

Operator-Approved Live Run

A live CALL-E call requires explicit operator approval.

The workflow is:

Care decision
    ↓
Deterministic safety gate
    ↓
No-call preview
    ↓
Explicit operator approval
    ↓
Authorized destination validation
    ↓
CALL-E live call

A model recommendation is not operator approval.

The system must not initiate a live call merely because a language model recommends calling.

If operator approval is absent, the workflow stops without placing a call.

Safety Gate

Never allow a language model alone to authorize an automated healthcare call.

Before initiating a live call, verify all required conditions:

An authorized patient phone number exists.
The destination is valid and approved for the current run.
The care decision explicitly permits a routine follow-up call.
The patient's risk level satisfies the application's automated-call threshold.
The patient's priority satisfies the application's automated-call threshold.
The call reason is traceable to a structured care decision.
The call is associated with the correct patient record.
The same call has not already been initiated.
Explicit operator approval has been obtained for the live run.

If any required condition fails, do not initiate the call.

Do not bypass or weaken the safety gate because a model recommends calling.

Detailed safety guidance is in references/safety.md.

Destination Validation

Live calls must use an authorized destination.

The destination must:

be explicitly authorized for the current demonstration or run
be valid E.164 format
come from a trusted application field rather than arbitrary model-generated text
not be replaced by a destination supplied in free-form model output

Do not expose full phone numbers in logs, screenshots, examples, or public documentation.

Use masked or clearly fake values in community examples.

Call Initiation

Phone numbers should be stored and supplied in E.164 format.

CALL-E API credentials must remain server-side and must never be exposed to:

browser code
frontend applications
client-side environment variables
logs
screenshots
public repositories
documentation

Only initiate a live call after the deterministic safety gate and explicit operator approval have passed.

The system should record:

patient identifier
call reason
care decision identifier
risk level
priority
call timestamp
CALL-E call identifier
call status

Displayed logs and summaries should mask sensitive identifiers and destinations.

Patient Conversation

The follow-up call should be concise and focused on collecting information relevant to the existing care decision.

The caller should:

Identify the healthcare service appropriately.
Confirm that the patient is available to talk.
Explain the reason for the follow-up.
Ask whether relevant symptoms have improved, remained stable, or worsened.
Ask about medication adherence when applicable.
Identify urgent concerns.
Record the patient's responses.
Avoid making unsupported medical diagnoses.

The caller should not claim to be a doctor or replace professional medical judgment.

The conversation should collect patient-reported information rather than attempting to independently diagnose the patient.

Call Outcome Handling

Only process a call after a trustworthy terminal result has been received.

If the provider reports an unknown, ambiguous, unavailable, or otherwise unreconciled outcome:

Stop the automated workflow.
Do not assume that the patient answered.
Do not assume that the patient failed to answer.
Do not fabricate symptoms or health status.
Do not create a successful patient event from an unverified outcome.
Do not automatically retry.
Reconcile the provider call status.
Continue only after a verified terminal result is available.

An unknown outcome is a stop condition, not a successful or failed clinical outcome.

Structured Outcome

Convert a verified completed call into structured information.

A result may contain fields such as:

{
  "patient_reached": "yes",
  "health_status": "stable",
  "symptoms": [],
  "medication_adherence": "partial",
  "urgent": false,
  "notes": "",
  "next_action": "continue_followup"
}

Only information actually obtained from the call should be represented as a patient-reported outcome.

Do not invent missing fields or infer a clinical condition that was not established by the conversation.

Patient Event and Reassessment

When a verified completed call produces a valid patient-reported outcome:

Record the structured outcome.
Associate it with the corresponding call record.
Create the appropriate patient event.
Reassess the patient's longitudinal state.
Determine the next care action.

Processing should be idempotent so that the same completed call cannot create duplicate patient events.

Failed, cancelled, or unreconciled calls must not be represented as successful patient-reported clinical outcomes.

Cancellation Limits

Preview cancellation is always possible because no external call has been initiated.

Before live initiation, the operator can cancel by withholding approval.

After a live call has been accepted by the external calling provider, cancellation is provider-dependent and is not guaranteed.

Do not claim that an accepted call can always be cancelled.

If cancellation is requested, report the actual provider state honestly. A call that has already been accepted for execution or connected may be unavailable for cancellation or may still complete.

Demo and Community Use

This skill is intended as a reusable community/demo workflow.

Examples must use masked or clearly fake identifiers and destinations.

Do not include:

API keys
credentials
private patient information
real phone numbers
production secrets
private infrastructure details

The workflow is designed to demonstrate safe agentic calling patterns and is not a substitute for clinical judgment or production healthcare governance.


### 2. `skills/vaidya-care-call/references/safety.md`

```markdown
# Vaidya Care Call Safety

## Core Principle

A language model must never be the sole authority for initiating a healthcare phone call.

The workflow must separate:

1. model recommendation
2. deterministic safety validation
3. no-call preview
4. explicit operator approval
5. live CALL-E execution

## No-Call Preview

Preview mode must not contact the patient.

The preview should show:

- proposed call reason
- care decision
- risk level
- priority
- safety-gate result
- destination authorization status
- masked destination
- operator approval requirement

Example:

```text
Safety gate: PASS
Destination: +91••••••5837
Live call: NOT STARTED
Operator approval: REQUIRED
Operator Approval

A live call requires explicit operator approval after the preview has been generated.

The following is not sufficient:

model recommendation
automatic care decision
a valid phone number alone
a passing risk threshold alone

If operator approval is missing, do not initiate CALL-E.

Authorized Destinations

Only an explicitly authorized destination may be used.

Destinations must:

be valid E.164 numbers
belong to an approved demonstration or run
come from trusted application state
not be taken from arbitrary model output

Public examples must use masked or fake numbers.

Deterministic Safety

The deterministic safety gate must remain authoritative.

A model must not be able to:

bypass the gate
change the gate
grant itself permission
select an unauthorized destination
convert a blocked decision into an approved call
Masking

Never expose complete phone numbers in:

logs
screenshots
README files
examples
public repositories

Use masking such as:

+91••••••5837

Use fake identifiers for examples:

patient: CT-DEMO-102
call_id: call_demo_••••
Unknown Outcomes

An unknown or ambiguous provider result is a hard stop.

Do not infer:

patient reached
patient not reached
health improved
health worsened
symptoms
medication adherence

Do not create a patient event from an unverified result.

Do not automatically retry.

First reconcile the provider's call status. Continue only after a trustworthy terminal state is available.

Cancellation

Preview cancellation is always possible because no call has been placed.

Before initiation, cancellation means withholding operator approval.

After provider acceptance, cancellation depends on the provider's actual state.

A connected or accepted call may not be cancellable.

The system must report the real provider state rather than claiming cancellation succeeded when it cannot be verified.

Community Safety

This skill is a reusable demonstration workflow.

Do not include real patient data, production credentials, private phone numbers, or secrets.

The skill does not replace professional medical judgment.


### 3. `skills/vaidya-care-call/references/examples.md`

```markdown
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
Before live initiation
Operator approval: NOT GIVEN
Action: CANCEL
CALL-E call: NOT STARTED
After provider acceptance
Call ID: call_demo_••••
Provider status: accepted
Cancellation: provider-dependent
