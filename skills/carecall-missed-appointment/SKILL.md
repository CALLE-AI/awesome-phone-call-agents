---
name: carecall-missed-appointment
description: Recover missed healthcare appointments through a safe administrative CALL-E conversation that verifies the patient, offers available rescheduling slots, confirms the selected slot, and returns a structured recovery outcome for a downstream appointment system.
license: MIT
---

The reference workflow is designed to:

1. Confirm the intended patient.
2. Inform them that they were unable to attend their appointment.
3. Ask whether they would like to reschedule.
4. Offer available appointment slots supplied by the host system.
5. Confirm the slot selected by the patient.
6. Return a structured result that a host system can use to update the appointment.

This is a workflow skill, not a medical assistant and not a replacement for a clinical professional.

This repository contribution is reference workflow documentation. It does not itself execute CALL-E calls.

A host application is responsible for integrating with CALL-E, explicitly authorizing each real call, supplying the destination phone number and appointment data, handling credentials, preventing duplicate calls, and applying the returned structured result.

Any runnable CareCall implementation lives outside this skill package and must provide its own safe default, such as dry-run, fake-server, or explicit opt-in before placing a real call.

---

# CareCall — Missed Appointment Recovery

## Why this exists

Missed healthcare appointments create administrative overhead for clinics and can leave appointment slots unused.

`carecall-missed-appointment` automates the administrative recovery workflow after a patient misses an appointment.

The skill places an outbound CALL-E call to:

1. Confirm the intended patient.
2. Inform them that they were unable to attend their appointment.
3. Ask whether they would like to reschedule.
4. Offer available appointment slots.
5. Confirm the slot selected by the patient.
6. Return a structured result that a host system can use to update the appointment.

This is a workflow skill, not a medical assistant and not a replacement for a clinical professional.

It wraps CALL-E's existing one-off call API and structured-result capability.

## When To Use

Use this skill when:

- a patient has missed an existing healthcare appointment
- the clinic wants to proactively offer rescheduling
- available appointment slots are known
- the result needs to be written back to an appointment or scheduling system
- the workflow needs a structured outcome such as `RESCHEDULED`, `DECLINED`, or `CALLBACK_REQUESTED`

## When Not To Use

Do not use this skill to:

- provide medical advice
- diagnose symptoms or conditions
- interpret test results
- recommend treatment
- triage medical conditions
- discuss unnecessary clinical information
- contact a person whose phone number was not explicitly provided
- invent appointment availability
- disclose appointment information before appropriate patient verification
- pressure a patient into rescheduling
- make clinical decisions

## Required Input

The host system should provide:

- `patient_name`
- `phone_number` in E.164 format
- `missed_appointment_date`
- `missed_appointment_time`
- `available_slots`

Each available slot should contain a specific date and time.

The host system must obtain and provide the correct appointment information. The skill must not invent or infer appointment details.

## Core Workflow

1. Receive the missed appointment details from the host system.

2. Confirm that the recipient is the intended patient before disclosing appointment details.

3. Explain that the patient was unable to attend their appointment.

4. Ask whether they would like to reschedule.

5. If the patient declines:
   - respect the decision
   - do not pressure them
   - return `DECLINED`

6. If the patient wants to reschedule:
   - present only the available slots supplied by the host system
   - allow the patient to select a slot
   - confirm the selected date and time

7. If the patient explicitly confirms the selected slot:
   - return `RESCHEDULED`
   - include the selected slot

8. If the patient asks to be contacted later:
   - return `CALLBACK_REQUESTED`

9. If the recipient is not the intended patient:
   - do not disclose appointment information
   - return `WRONG_PERSON`

10. If the patient raises a medical concern:
    - do not provide medical advice
    - stop the normal scheduling flow
    - return `CLINICAL_FOLLOWUP_REQUIRED`

11. If an urgent or potentially dangerous situation is raised:
    - stop the scheduling workflow
    - follow the clinic's approved emergency escalation policy
    - return `SAFETY_ESCALATION`

12. If the conversation cannot establish a reliable outcome:
    - return `UNKNOWN`
    - do not guess the result

## Conversation Guidelines

The agent should be:

- polite
- concise
- calm
- empathetic
- conversational
- non-judgmental

Use natural language rather than requiring exact yes/no responses.

For example, responses such as:

- "Yes, please."
- "That would be great."
- "Sure, let's move it."
- "I can't make that time."

should be understood naturally.

Do not repeatedly ask a question when the patient has already answered it.

Do not force the patient to repeat information unnecessarily.

A suitable opening is:

> "Hi, is this [patient first name]?"

After appropriate verification:

> "I'm calling from CareCall about your missed appointment on [date] at [time]. We'd be happy to help arrange another time if you'd like."

Avoid judgmental language such as:

> "Why did you miss your appointment?"

## Safety Rules

### Administrative-only scope

The agent must only perform appointment coordination.

It must never:

- diagnose
- interpret symptoms
- recommend medication
- recommend treatment
- interpret test results
- provide clinical instructions

### Patient verification

Do not disclose unnecessary appointment information to an unverified person.

If the recipient is not the intended patient, end the appointment-recovery conversation without revealing sensitive details.

### Clinical concerns

If the patient introduces a medical concern, do not attempt to answer it.

Stop the scheduling workflow and mark:

`CLINICAL_FOLLOWUP_REQUIRED`

The host system can then route the case to appropriate clinic staff.

### Safety escalation

If the patient describes a potentially urgent situation, do not attempt medical triage.

Stop the appointment workflow and follow the healthcare organization's approved emergency escalation process.

### No pressure

The patient may decline rescheduling.

The agent must accept the decision without persuasion.

### Appointment availability

The agent may only offer slots supplied by the host system.

It must never invent, modify, or promise availability.

### Real-world call safety

Phone calls are real-world side effects.

The host system must explicitly authorize the recovery workflow before placing the call.

The phone number must be explicitly supplied by the host system and must not be guessed.

Phone numbers should be masked in logs and user-facing output.

### Credentials

Never expose CALL-E API keys, access tokens, or other credentials in logs, transcripts, responses, or committed files.

## Structured Result

## References

For detailed guidance, load these references when needed:

- `references/result-schema.md` — structured result fields, allowed values, validation rules, and examples.
- `references/safety.md` — detailed safety, verification, escalation, and data-minimization rules.

The skill returns a structured result containing:

- `outcome`
- `patient_confirmed`
- `follow_up_required`
- `selected_slot`

Possible outcomes:

- `RESCHEDULED`
- `DECLINED`
- `CALLBACK_REQUESTED`
- `NO_ANSWER`
- `WRONG_PERSON`
- `CLINICAL_FOLLOWUP_REQUIRED`
- `SAFETY_ESCALATION`
- `UNKNOWN`

`selected_slot` should contain `NONE` when no slot was selected.

The host application is responsible for applying the result to the underlying appointment system.

## Success Criteria

A call may be considered `RESCHEDULED` only when:

1. the intended patient was appropriately verified
2. the patient explicitly agreed to reschedule
3. an available slot was selected
4. the selected slot was explicitly confirmed

A high-confidence CALL-E result should be preferred, but the host system must not fabricate an outcome when the conversation is ambiguous.

## Example Result

```json
{
  "outcome": "RESCHEDULED",
  "patient_confirmed": "YES",
  "follow_up_required": "NO",
  "selected_slot": "SLOT-003"
}
