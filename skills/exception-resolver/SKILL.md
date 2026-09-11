---
name: exception-resolver
description: Resolve operational exceptions by gathering missing information through an authorized CALL-E phone conversation and returning a structured result for human approval. Use when an AI agent encounters a supported operational exception that cannot be resolved from available system data and requires information from an authorized person.
---

# Exception Resolver

Resolve operational exceptions by gathering missing information through an authorized CALL-E phone conversation and returning a structured result for human approval.

## Purpose

Use this skill when an AI agent detects a supported operational exception that cannot be resolved from available system data and requires information from an authorized person.

Read `references/resolution-workflow.md` for the detailed exception-resolution workflow and safety requirements.

## Workflow

1. Identify the operational exception and available context.
2. Determine what information is missing.
3. Establish explicit per-run intent for the proposed call.
4. Confirm the destination is an authorized contact and the phone number is valid strict E.164 format.
5. Check that the call is not a duplicate and that no unresolved prior call already covers the same exception and intent.
6. Decide whether a phone call is necessary.
7. Place a CALL-E call only after the required safety checks pass.
8. Gather the information required to understand the exception.
9. Treat uncertain, incomplete, failed, cancelled, refused, or ambiguous outcomes as unresolved.
10. Return the call outcome as structured operational data with masked phone output.
11. Present the proposed resolution to a human decision-maker.
12. Apply the resolution only after human approval.

## Per-run intent

Before placing a call, the agent MUST have explicit intent for that specific run.

The intent must identify:

- the exception being resolved
- the operational objective of the call
- the authorized party or role to contact
- the information the agent is permitted to request or disclose
- the expected resolution or decision
- whether the call may create an external side effect

Do not infer permission to call merely because an exception exists.

If intent is missing, ambiguous, unauthorized, or outside this skill's supported workflow, do not place the call.

## Phone-number requirements

Outbound phone numbers MUST be supplied in strict E.164 format.

Example of valid format:

`+14155550123`

Do not accept or silently reinterpret local, punctuation-formatted, or whitespace-formatted numbers as E.164.

Examples that must be rejected:

- `4155550123`
- `(415) 555-0123`
- `415-555-0123`
- `+1 415 555 0123`

Use only authorized contact information.

Phone numbers shown in user-facing output, examples, logs, and status summaries MUST be masked unless the complete number is strictly required for the actual call operation.

## Duplicate-call stopping

Before initiating a call, check for an existing active, pending, or recently completed call for the same exception and operational intent.

If a duplicate is detected:

- do not place another call
- return a clear duplicate/stopped status
- preserve the existing call result
- require explicit new authorization before another call is initiated

Do not repeatedly call a person because an exception remains unresolved.

## Ambiguous-outcome stopping

Never treat an ambiguous call outcome as a successful resolution.

Treat these outcomes as unresolved:

- unknown
- interrupted
- contradictory
- incomplete
- unavailable
- unclear
- missing required confirmation
- refused
- failed

When an outcome is ambiguous:

1. stop the automated resolution workflow
2. do not invent or infer a resolution
3. do not automatically repeat the call
4. return an unresolved/ambiguous status
5. require human or explicitly authorized workflow review

## Cancellation

A pending call workflow must be cancellable before execution.

If a supported CALL-E cancellation mechanism is available for an active call, use it.

After cancellation:

- mark the workflow as cancelled
- do not automatically restart it
- preserve the cancellation state
- require explicit new authorization before another call

## Safety

- Use only authorized contact information.
- Do not expose credentials, secrets, or unnecessary sensitive information during a call.
- Clearly disclose AI involvement when required.
- Treat uncertain, incomplete, refused, cancelled, failed, or ambiguous call results as unresolved.
- Do not allow the phone conversation alone to authorize consequential actions.
- Keep final resolution decisions under human control.
- Do not claim that a phone conversation by itself proves identity, consent, authorization, or legal validity.
- Use fictional or masked phone numbers in examples.

## High-stakes boundaries

Do not autonomously make or resolve calls involving high-stakes decisions or actions such as:

- medical care or treatment decisions
- emergency response
- legal decisions or legal representation
- financial transactions or financial decisions
- safety-critical operational decisions
- identity or security verification where a phone call alone is insufficient
- disclosure of sensitive personal information without appropriate authorization

When high-stakes content is detected:

1. stop the automated resolution workflow
2. do not make an unauthorized call
3. surface the issue to a human/operator
4. preserve the exception context needed for human review
5. require explicit authorization before any permitted next action

## Example Use Cases

- Shipment exception follow-up
- SLA risk investigation
- Vendor delay clarification
- Service disruption follow-up
- Missing operational information

Examples must use fictional or masked phone numbers and must demonstrate authorization, safety checks, cancellation, duplicate stopping, and ambiguous-outcome handling.

## Result

The skill should return structured information describing:

- exception
- information gathered
- call outcome
- proposed resolution
- confidence
- human approval status
- next action

Phone numbers in normal result output should be masked.

## References

- `references/resolution-workflow.md`
- Repository safety reference covering consent, E.164 phone-number handling, credential boundaries, cancellation, duplicate-job prevention, and high-stakes boundaries
- Repository examples/reference patterns for safe phone-call workflows
- 
