# RDN Intake & Referral Agent

A consent-based AI phone intake workflow built with CALL-E to collect structured nutrition-support information and prepare a referral-ready summary for Registered Dietitian Nutritionist (RDN) review.

## Overview

The RDN Intake & Referral Agent explores how an AI phone agent can support the initial intake stage of a healthcare nutrition workflow.

The current prototype uses CALL-E to conduct an outbound phone conversation on behalf of an RDN or care team. The AI identifies itself, requests consent, collects structured intake information, reads the information back for confirmation, and produces a structured JSON result for human review.

The AI is designed to support the intake and coordination process, not replace the RDN.

## Why I Built This

Healthcare nutrition support often begins with collecting basic information before an RDN can review a patient's needs and determine the appropriate next step.

A phone conversation can require repetitive information gathering, while important details need to be captured consistently.

This project explores whether an AI phone agent can handle this initial information-collection step while keeping the RDN or care team responsible for clinical review and follow-up.

The goal is to transform an unstructured phone conversation into organized, patient-confirmed information that can support the next stage of the workflow.

## Current Workflow

The current prototype follows this workflow:

```text
RDN / Care Team
      |
      v
CALL-E AI Phone Agent
      |
      v
AI Disclosure
      |
      v
Patient Consent
      |
      v
Structured Intake
      |
      +-- Patient name
      +-- Reason for nutrition support
      +-- Healthcare referral status
      +-- Nutrition goals
      +-- Dietary preferences / restrictions
      +-- Food allergies
      +-- General location
      +-- Optional insurance information
      +-- Preferred RDN appointment time
      |
      v
Information Readback
      |
      v
Patient Confirmation
      |
      v
Structured JSON Result
      |
      v
RDN / Care Team Review
      |
      v
Human Follow-up
```

The current prototype collects a preferred appointment time but does not schedule or confirm an appointment.

## What the AI Does

The AI phone agent is responsible for communication and information collection.

It:

1. Identifies itself as an AI assistant.
2. Requests consent before continuing.
3. Collects the required intake information.
4. Handles optional information such as insurance.
5. Collects the patient's preferred appointment time.
6. Reads the collected information back to the patient.
7. Requests confirmation.
8. Produces structured JSON for downstream human review.
9. Maintains defined healthcare safety boundaries.
10. Stops or hands off when the conversation is outside the intended intake scope.

## What the AI Does Not Do

The prototype is intentionally not a medical advisor.

It does not:

- Diagnose medical conditions.
- Prescribe treatment.
- Interpret medical information.
- Provide individualized medical or nutrition advice.
- Make clinical decisions.
- Confirm a medical appointment.
- Replace an RDN or other qualified healthcare professional.

Clinical decisions and appropriate patient follow-up remain with the RDN or care team.

## Project Structure

```text
rdn-intake-referral/
|
+-- SKILL.md
|   Core CALL-E Agent Skill. Defines the phone interaction,
|   intake workflow, structured output, confirmation behavior,
|   and operational safety requirements.
|
+-- TEST_RESULTS.md
|   Synthetic validation scenarios demonstrating the
|   intended workflow and safety behavior.
|
+-- references/
|   |
|   +-- safety.md
|   |   Healthcare safety boundaries and fail-closed behavior.
|   |
|   +-- examples.md
|       Synthetic examples that demonstrate the intended
|       skill behavior.
|
+-- examples/
    |
    +-- test-input.json
        Synthetic example input for demonstrating the
        CALL-E RDN intake workflow.
```

## Why Each File Exists

### `SKILL.md`

`SKILL.md` is the core instruction layer for the Agent Skill.

It defines what the CALL-E agent should do during the phone conversation, what information should be collected, how the result should be structured, and how the agent should behave when safety or consent conditions are not satisfied.

Without `SKILL.md`, the project would not have a defined Agent Skill workflow.

### `references/safety.md`

Healthcare conversations can move beyond basic intake.

This file provides explicit safety boundaries so the agent does not cross from information collection into medical or nutrition advice.

It supports fail-closed behavior for situations such as unclear consent, requests to stop, emergencies, incorrect recipients, or unreliable information.

### `references/examples.md`

Examples make the intended behavior easier to understand and extend.

They provide synthetic scenarios that help explain how the Skill should behave during different types of phone interactions.

### `TEST_RESULTS.md`

`TEST_RESULTS.md` documents synthetic validation scenarios for the RDN intake workflow.

The scenarios are intentionally fictional and are designed to demonstrate expected behavior without representing real patient interactions, clinical encounters, or clinical outcomes.

### `examples/test-input.json`

This file provides a synthetic example of the input structure for the RDN intake workflow.

It demonstrates the CALL-E task definition, recipient configuration structure, intake fields, and safety requirements using fictional information.

The example does not contain real patient information, credentials, private phone numbers, or live-call artifacts.

### `README.md`

This README provides the larger context around the project.

It explains why the project exists, how the components work together, what each file is responsible for, the current limitations, and the future direction.

## Structured Output

The conversation is converted into structured information rather than relying only on a raw transcript.

The following is a wholly synthetic example:

```json
{
  "patient_name": "Jordan Lee",
  "reason_for_support": "General nutrition support",
  "nutrition_goals": [
    "Develop healthier eating habits"
  ],
  "dietary_preferences_or_restrictions": [
    "Vegetarian"
  ],
  "location": "Example City, California",
  "insurance_information": null,
  "preferred_appointment_times": [
    "Next Wednesday afternoon"
  ],
  "rdn_referral_needed": "yes",
  "patient_confirmed_information": "yes"
}
```

The structured result is intended to give the RDN or care team a concise, organized starting point for human review.

The example above is fictional and does not represent a real patient or clinical encounter.

## Why Patient Confirmation Matters

Voice conversations are unstructured and can contain misunderstandings.

Before producing the final intake result, the agent reads the collected information back to the patient and asks for confirmation.

This creates an additional verification step before the information is passed to the downstream human workflow.

## Why the RDN Remains in the Loop

The purpose of this project is not to automate clinical decision-making.

The AI handles communication and repetitive information collection, while the RDN or care team remains responsible for reviewing the information, determining appropriate care, and communicating with the patient.

This separation keeps the prototype focused on workflow support rather than clinical automation.

## Testing

The repository includes synthetic validation scenarios covering:

- AI disclosure
- Consent
- Structured intake
- Safety-boundary handling
- Information readback
- Patient confirmation
- Structured JSON generation
- Human/RDN review

These scenarios are fictional documentation fixtures. They are not records of real patient interactions, clinical encounters, or clinical outcomes.

See [`TEST_RESULTS.md`](../skills/rdn-intake-referral/TEST_RESULTS.md) for the synthetic validation scenarios.

### Reproducing the Example

A synthetic example input is provided at [`examples/test-input.json`](../skills/rdn-intake-referral/examples/test-input.json).

The fixture is intended for documentation and workflow demonstration. Any real-world testing should use an authorized test recipient, appropriate credentials, and applicable privacy and security controls.

No real patient information, private phone numbers, API keys, insurance/member numbers, or raw sensitive transcripts should be committed to the repository.

## Design Principles

The project follows several design principles:

### Consent First

The agent identifies itself and obtains consent before proceeding with the intake.

### Human-Centered Workflow

The AI supports the RDN and care team instead of replacing them.

### Structured Information

Important information is converted from natural conversation into structured output.

### Confirmation Before Handoff

The patient is given an opportunity to confirm the collected information.

### Safety Boundaries

The AI remains within information collection and referral coordination and does not provide individualized medical or nutrition advice.

### Fail Closed

When the agent cannot safely continue, it should stop or defer to appropriate human handling rather than guessing.

### Privacy by Design

Public documentation uses wholly synthetic examples and should not contain real patient information, private phone numbers, insurance/member numbers, or raw sensitive transcripts.

## Current Prototype vs. Future Development

### Current Prototype

The current prototype supports:

- Outbound AI phone calls
- AI disclosure
- Consent-based intake
- Nutrition-support information collection
- Patient confirmation
- Structured JSON output
- RDN-ready referral information
- Human/RDN follow-up

### Future Development

A future production implementation could connect the structured intake output to an RDN scheduling or care-management system.

A possible future workflow would be:

```text
RDN / Care Team
      |
      v
CALL-E AI Intake
      |
      v
Patient Consent + Intake
      |
      v
Patient Confirmation
      |
      v
Structured Patient Information
      |
      v
RDN / Care Management System
      |
      v
Appointment Coordination
      |
      v
Human / Authorized System Confirmation
```

Scheduling and appointment confirmation are intentionally outside the current prototype.

## Technology

- CALL-E
- Agent Skills
- Python
- AI / LLM-based conversational workflow
- Structured JSON
- Voice AI
- Healthcare AI safety patterns

## Project Goal

The project demonstrates how phone-based AI can reduce repetitive intake work while preserving a human-centered healthcare workflow.

The intended outcome is not to replace the RDN.

The intended outcome is to help the RDN begin with organized, patient-confirmed information instead of an unstructured phone conversation.

## Hackathon Context

This project was developed for the CALL-E hackathon, exploring practical applications of AI-powered phone interactions.

The project contributes an RDN-focused healthcare intake workflow as a reusable CALL-E Agent Skill.

## Status

**Prototype -- Synthetic validation documentation included.**

The current implementation focuses on intake and referral coordination. Production deployment would require appropriate healthcare, privacy, security, consent, clinical, and operational review.

Public repository artifacts use synthetic examples; live test credentials, personal phone numbers, and sensitive patient information are intentionally excluded.
