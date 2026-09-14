# Safety Guidelines

## Deterministic Authorization

Healthcare phone calls must never be authorized solely by an LLM-generated instruction.

A deterministic application-level safety gate must evaluate the care decision before CALL-E is invoked.

The language model may recommend a follow-up action, but the application must independently determine whether an automated call is permitted.

## Required Checks

Before initiating an automated follow-up call, verify:

- An authorized patient phone number exists.
- The care decision explicitly permits the automated follow-up action.
- The patient's risk level satisfies the application's automated-call threshold.
- The patient's priority satisfies the application's automated-call threshold.
- The call reason is traceable to a structured care decision.
- The request is associated with the intended patient record.
- The same call has not already been initiated.

If any required check fails, the call must not be initiated.

Do not bypass, weaken, or override the safety gate because a model recommends calling.

## Phone Number Safety

Phone numbers should be stored and supplied in E.164 format.

Only use phone numbers that have been authorized for the intended patient communication workflow.

Never use a phone number obtained from an untrusted model output without application-level validation and authorization.

## API Key Protection

CALL-E API credentials must remain server-side.

Never expose API keys or authentication credentials in:

- frontend code
- browser requests
- client-side environment variables
- public repositories
- screenshots
- documentation
- logs
- error messages

Calls to CALL-E should be made by a trusted server-side component.

## Patient Identity

Before initiating a call, verify that the phone number and care decision belong to the intended patient.

Do not allow a model-generated patient identifier or phone number to silently determine the call recipient.

The application should resolve the patient through trusted application data before initiating the call.

## Escalation

Urgent or emergency situations should follow the application's escalation workflow.

Do not automatically reinterpret an escalation decision as permission to place a routine follow-up call.

If the patient's situation requires clinical judgment or immediate human attention, surface the case to the appropriate healthcare worker according to the application's escalation policy.

## Privacy

Never publish real patient information in source code, examples, tests, screenshots, or documentation.

Do not expose:

- real patient names
- real patient phone numbers
- medical records
- API keys
- authentication tokens
- private database identifiers

Use synthetic or masked patient information in examples.

For example:

```text
Patient: Example Patient
Phone: +91XXXXXXXXXX
Call Authorization and Auditability

A permitted call should be traceable to the care decision that authorized it.

Record sufficient metadata to establish why the call was initiated, including:

patient identifier
care decision identifier
call reason
risk level
priority
CALL-E call identifier
call status
timestamps

Avoid storing unnecessary sensitive information.

Idempotency

Call initiation and result processing should be protected against duplicate execution.

A repeated webhook, callback, or processing attempt must not:

initiate duplicate calls
create duplicate patient events
create duplicate care decisions
overwrite a valid result with an older result

Use a stable CALL-E call identifier or equivalent idempotency mechanism when available.

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
Human Oversight

Automated routine follow-up should not be presented as replacing healthcare workers.

The purpose of the workflow is to reduce repetitive follow-up work while preserving human oversight for patients who require additional attention.

Automation should handle only the actions permitted by the application's safety policy.

Cases requiring clinical judgment should remain within the appropriate human-review or escalation workflow.

Core Safety Principle

The upstream healthcare agent may identify that a follow-up action is appropriate.

A deterministic safety layer decides whether an automated call is permitted.

CALL-E performs the communication action only after that authorization succeeds.

The result of the call becomes new information in the patient's longitudinal care timeline.

The healthcare workflow then reassesses the patient and determines what should happen next.
