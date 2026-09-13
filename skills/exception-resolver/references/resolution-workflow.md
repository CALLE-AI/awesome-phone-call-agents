# Exception Resolution Workflow

## Purpose

Exception Resolver is a reusable workflow for situations where an operational system detects an exception but the information required to resolve it exists with a human.

The workflow uses CALL-E to gather that information by phone, converts the conversation into structured operational data, and keeps the final resolution decision with a human.

This workflow is designed to stop safely when authorization, identity, call outcome, or required information is uncertain.

## 1. Detect

Identify an operational exception and collect the context already available from the source system.

Examples include:

- Shipment delays
- SLA risks
- Vendor exceptions
- Service disruptions
- Missing operational information

Record:

- Exception type
- Exception ID
- Current status
- Known facts
- Business impact
- Relevant deadlines
- Authorized contact

Do not initiate a call merely because an exception exists.

## 2. Determine What Is Missing

Separate known information from information that must be obtained from a person.

The agent should identify the minimum information needed to evaluate the exception.

A call must have a specific operational information-gathering purpose.

Before a call is initiated, establish explicit per-run intent containing:

- The exception being resolved
- The operational objective of the call
- The authorized person or role to contact
- The information the agent is permitted to request or disclose
- The expected resolution or decision
- Whether the call may create an external side effect

If the intent is missing, ambiguous, or unauthorized, do not place the call.

## 3. Validate the Call Before Initiation

Before initiating a CALL-E interaction:

### Authorization

Confirm that:

- The destination is an authorized contact for the exception.
- The agent is authorized to make the call.
- The information requested is necessary for the stated purpose.
- The agent is not exceeding its disclosure or decision authority.

### Phone number

The destination phone number MUST be supplied in strict E.164 format.

Valid example:

`+14155550123`

Reject numbers such as:

- `4155550123`
- `(415) 555-0123`
- `415-555-0123`
- `+1 415 555 0123`

Do not silently reinterpret a non-E.164 number as a valid destination.

### Duplicate-call check

Before placing the call, check whether there is already:

- An active call for the same exception
- A pending call for the same exception and purpose
- A completed call that already produced a usable result for the same exception and purpose

If a duplicate is detected:

1. Do not place another call.
2. Preserve the existing call/result information.
3. Return a duplicate/stopped status.
4. Require explicit new authorization before another call is attempted.

Do not repeatedly call a person because an exception remains unresolved.

## 4. Initiate the CALL-E Interaction

When a phone conversation is appropriate and all pre-call checks pass, use CALL-E to contact the authorized person.

The call should:

- Explain the reason for the contact
- Identify the agent appropriately
- Ask focused questions
- Confirm important facts
- Avoid exposing unnecessary sensitive information
- Avoid making commitments the agent is not authorized to make
- Stay within the explicit per-run intent

Do not disclose credentials, secrets, or unnecessary personal information.

## 5. Cancellation

A pending call workflow must be cancellable before execution.

If the call has not started:

1. Cancel the pending call/workflow.
2. Mark the operation as cancelled.
3. Do not automatically restart it.

If CALL-E provides a supported cancellation mechanism for an active call, use that mechanism.

After cancellation, a new call requires explicit new authorization.

Cancellation must be treated as a terminal outcome for that run.

## 6. Handle Call Outcomes

Possible outcomes include:

- Information successfully obtained
- No answer
- Voicemail
- Call declined
- Incomplete information
- Conflicting information
- Technical failure
- Cancelled
- Ambiguous outcome

A failed or ambiguous call must not be treated as a successful resolution.

### Ambiguous outcomes

Treat the outcome as ambiguous when the required information or confirmation cannot be established with sufficient confidence.

Examples include:

- Contradictory answers
- Incomplete answers
- Unclear caller response
- Interrupted call
- Missing required confirmation
- Unknown call state
- Uncertain whether the requested action occurred

When the outcome is ambiguous:

1. Stop the automated resolution workflow.
2. Do not invent or infer a resolution.
3. Do not automatically retry the call.
4. Keep the exception unresolved.
5. Return an `ambiguous` or `unresolved` outcome.
6. Require human review or explicit authorization for the next action.

An ambiguous outcome is never equivalent to success.

## 7. High-Stakes Boundaries

Do not autonomously resolve or make calls for high-stakes decisions or actions involving:

- Medical care or treatment decisions
- Emergency response
- Legal decisions or legal representation
- Financial transactions or financial decisions
- Safety-critical operational decisions
- Identity or security verification where a phone call alone is insufficient
- Disclosure of sensitive personal information without appropriate authorization

When high-stakes content is detected:

1. Stop the automated resolution workflow.
2. Do not make an unauthorized call.
3. Preserve the relevant exception context.
4. Surface the issue to a human/operator.
5. Require explicit authorization before any permitted next action.

A phone conversation alone must not be treated as proof of identity, consent, authorization, legal validity, or approval for a consequential action.

## 8. Structure the Result

Convert the conversation into structured operational information.

The result should include:

```json
{
  "exception": "string",
  "information_gathered": [],
  "call_outcome": "success|no_answer|voicemail|declined|incomplete|conflicting|failed|cancelled|ambiguous",
  "proposed_resolution": "string",
  "confidence": "high|medium|low",
  "human_approval_required": true,
  "human_approval_status": "pending|approved|rejected",
  "next_action": "string"
}
