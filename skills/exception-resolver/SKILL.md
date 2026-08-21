# Exception Resolver

Resolve operational exceptions by gathering missing information through a CALL-E phone conversation and returning a structured result for human approval.

## Purpose

Use this skill when an AI agent detects an operational exception that cannot be resolved from available system data and requires information from a person.

## Workflow

1. Identify the operational exception and available context.
2. Determine what information is missing.
3. Decide whether a phone call is necessary.
4. Place a CALL-E call to the authorized contact.
5. Gather the information required to understand the exception.
6. Return the call outcome as structured operational data.
7. Present the proposed resolution to a human decision-maker.
8. Apply the resolution only after human approval.

## Safety

- Use only authorized contact information.
- Do not expose credentials or secrets during a call.
- Clearly disclose AI involvement when required.
- Treat uncertain, incomplete, refused, or failed call results as unresolved.
- Do not allow the phone conversation alone to authorize consequential actions.
- Keep final resolution decisions under human control.

## Example Use Cases

- Shipment exception follow-up
- SLA risk investigation
- Vendor delay clarification
- Service disruption follow-up
- Missing operational information

## Result

The skill should return structured information describing:

- exception
- information gathered
- call outcome
- proposed resolution
- confidence
- human approval status
- next action
