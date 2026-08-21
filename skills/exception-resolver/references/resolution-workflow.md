# Exception Resolution Workflow

## Purpose

Exception Resolver is a reusable workflow for situations where an operational system detects an exception but the information required to resolve it exists with a human.

The workflow uses CALL-E to gather that information by phone, converts the conversation into structured operational data, and keeps the final resolution decision with a human.

## Workflow

### 1. Detect

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

### 2. Determine What Is Missing

Separate known information from information that must be obtained from a person.

The agent should identify the minimum information needed to evaluate the exception.

Do not call simply because an exception exists. A call should have a specific information-gathering purpose.

### 3. Initiate the CALL-E Interaction

When a phone conversation is appropriate, use CALL-E to contact the authorized person.

The call should:

- Explain the reason for the contact
- Ask focused questions
- Confirm important facts
- Avoid exposing unnecessary sensitive information
- Avoid making commitments the agent is not authorized to make

### 4. Handle Call Outcomes

Possible outcomes include:

- Information successfully obtained
- No answer
- Voicemail
- Call declined
- Incomplete information
- Conflicting information
- Technical failure

A failed or ambiguous call must not be treated as a successful resolution.

If the required information cannot be established, keep the exception unresolved and return the appropriate follow-up action.

### 5. Structure the Result

Convert the conversation into structured operational information.

The result should include:

```json
{
  "exception": "string",
  "information_gathered": [],
  "call_outcome": "string",
  "proposed_resolution": "string",
  "confidence": "high|medium|low",
  "human_approval_required": true,
  "human_approval_status": "pending|approved|rejected",
  "next_action": "string"
}
