---
name: phone-information-retriever
description: Use CALL-E to autonomously retrieve information from phone-based services and return the result in a clear structured format.
---

# Phone Information Retriever

## Purpose

This skill allows an AI agent to retrieve real-world information from services that are accessible through phone calls.

Instead of requiring a user to manually call a service, the agent can use CALL-E to make an authorized phone call, interact with the service, understand the response, and return the required information.

## Workflow

1. Understand what information the user needs.
2. Identify the appropriate phone-based service.
3. Use CALL-E to make the authorized phone call.
4. Communicate with the automated phone system.
5. Extract the relevant information.
6. Return the result clearly to the user.

## Example Use Cases

- Washing machine availability
- Bus and transportation enquiries
- Clinic/token enquiries
- College/admission enquiries

## Example

User:
"Are any washing machines available?"

Agent:
- Calls the authorized washing-machine phone system using CALL-E.
- Retrieves the machine status.
- Returns the result to the user.

Output:
"Machines 2 and 4 are available. Machines 1 and 3 are busy.
The next machine will be available at 7:30 PM."

## Implementation

The skill can be integrated with the CALL-E Python SDK using:

`client.calls.create_and_wait(...)`

The result can be requested as structured data using a result schema.

## Future Integrations

- ESP32 and IoT-enabled machines for real-time device status
- GPS and transportation APIs for live bus information
- Clinic databases for token and waiting-time information
- Existing APIs and databases
- Legacy phone-based information systems

## Impact

The goal is to make information trapped behind phone calls accessible through a conversational AI interface, reducing repetitive manual enquiries and allowing existing phone-based services to become AI-accessible without requiring every service to build a new application.
