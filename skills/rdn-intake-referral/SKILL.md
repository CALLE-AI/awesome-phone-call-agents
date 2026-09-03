---
name: rdn-intake-referral
description: Conducts a consent-based nutrition support intake by phone and returns a structured summary for Registered Dietitian Nutritionist referral and human follow-up.
---

# RDN Intake & Referral

## Purpose

Use this skill to conduct a short, consent-based phone conversation with a patient seeking nutrition support and produce a structured intake summary for review by a Registered Dietitian Nutritionist (RDN).

The skill is for intake and care coordination only. It does not diagnose medical conditions, prescribe treatment, or provide personalized medical or nutrition advice.

## Required Inputs

Before starting a live call, the workflow must have:

- The patient's phone number in E.164 format.
- Authorization to contact the patient for nutrition intake.
- The purpose of the call: nutrition support intake and possible RDN referral.
- Any available referral context supplied by the authorized caller or workflow.
- A clear indication that the patient should be informed they are speaking with an AI assistant.

Do not invent or infer a phone number, patient information, referral information, or insurance information.

## Preflight

Before any live call:

1. Verify that the phone number is present and formatted in E.164 format.
2. Verify that the calling purpose is nutrition intake and possible RDN referral.
3. Verify that the caller has authorization to contact the patient.
4. Confirm that no API key, credential, or authentication token is included in the call input.
5. Confirm that the workflow is ready to return a structured intake result.
6. If any required preflight condition fails, do not place the call and return `needs_human`.

Never guess missing information during preflight.

## Dry-Run Preview

Before a live call, generate a preview containing:

- The masked destination phone number.
- The purpose of the call.
- The information the agent intends to collect.
- The expected structured result fields.
- Any available referral context.

The preview must not place a phone call.

A live call may proceed only after the required authorization and confirmation conditions have been satisfied.

## CALL-E Goal Template

Use the following goal when planning the phone call:

> Conduct a consent-based nutrition support intake with the patient, explain that the caller is an AI assistant, collect only the information required for RDN referral, summarize the information back to the patient for confirmation, and return a structured intake result for human/RDN review.

The goal must not instruct the agent to diagnose, prescribe treatment, provide individualized medical or nutrition advice, or make clinical decisions.


## Workflow

1. Confirm that the patient agrees to continue with the intake.
2. Ask for the patient's name.
3. Ask why the patient is seeking nutrition support.
4. Ask whether the patient was referred by a healthcare professional.
5. Ask about the patient's nutrition goals.
6. Ask about relevant dietary preferences, restrictions, or food allergies.
7. Ask for the patient's state or general service location.
8. Ask for basic insurance information when relevant to the referral workflow.
9. Ask when the patient would generally be available for an RDN appointment.
10. Summarize the information collected and ask the patient to confirm that it is accurate.
11. Return a structured intake result for RDN review.

## Conversation Guidelines

- Use natural conversation rather than reading the questions as a rigid questionnaire.
- Ask follow-up questions only when information is missing or unclear.
- Keep the conversation concise and professional.
- Explain that the agent is an AI assistant when appropriate.
- Do not claim to be an RDN, physician, nurse, or other healthcare professional.
- Do not diagnose, prescribe, or recommend individualized medical or nutrition treatment.
- Do not interpret laboratory results or provide emergency medical guidance.
- If the patient describes an emergency or potentially urgent medical situation, stop the routine intake and direct the patient to appropriate emergency or urgent medical services.

## Structured Result

After the call, return a structured result using the following schema:

```json
{
  "status": "completed",
  "patient_name": "",
  "reason_for_support": "",
  "referral_status": "",
  "nutrition_goals": [],
  "dietary_preferences_or_restrictions": [],
  "location": "",
  "insurance_information": "",
  "preferred_appointment_times": [],
  "rdn_referral_needed": false,
  "patient_confirmed_information": false
}

```
### Result Status

- `completed` -- the intake was completed and the patient confirmed the collected information.
- `needs_human` -- the call failed, information could not be reliably extracted, consent was unclear, or another condition requires human review.
- `not_completed` -- the patient did not complete the intake.

### Result Rules

- Use only information explicitly provided by the patient.
- Never invent or infer missing information.
- Use an empty string or empty array when information was not provided.
- Set `rdn_referral_needed` to `true` only when the conversation establishes that nutrition support/RDN follow-up is appropriate within this workflow.
- Set `patient_confirmed_information` to `true` only after the agent reads back the collected information and the patient confirms it.
- Never treat voicemail as a completed intake.
- If the structured result cannot be reliably extracted, return `needs_human`.
- The structured result is for RDN or authorized human review and does not constitute medical advice.

## Live Planning

For a live call:

1. Use the CALL-E planning capability to create a call plan from the CALL-E Goal Template.
2. Review the planned recipient, call purpose, and expected outcome before execution.
3. Do not execute the call if the recipient, purpose, consent, or required inputs are unclear.
4. The planned call must instruct the agent to disclose that it is an AI assistant.
5. The plan must require the structured intake result to be returned after the conversation.
6. If planning fails or produces an ambiguous result, return `needs_human` and do not place the call.

## Call Execution

After the call plan has been reviewed and the required confirmation conditions have been satisfied:

1. Execute the planned call using the CALL-E call execution capability.
2. Monitor the call until a terminal result is available.
3. Do not treat silence, voicemail, an ambiguous response, or an unknown call state as a completed intake.
4. If the call terminates successfully, extract the structured intake result.
5. If the call fails or the result cannot be reliably extracted, return `needs_human`.
6. Do not automatically retry a failed or ambiguous call.
7. Do not expose the raw phone number, API credentials, authentication tokens, or other secrets in the final result.

## Cancellation and Idempotency

- The workflow is one-shot and must not create recurring calls.
- Do not automatically retry a call after an ambiguous, failed, or unknown result.
- If the patient asks to stop, end the intake and return `not_completed`.
- If the wrong person answers, do not disclose patient or referral information and end the call.
- Do not initiate a second call for the same intake unless a human explicitly authorizes it.
- Do not treat a voicemail or unanswered call as patient consent or a completed intake.

## References

- `references/safety.md` -- Safety requirements for consent, healthcare boundaries, data protection, call execution, and human review.