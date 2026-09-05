# Examples

This document provides safe and unsafe examples for the RDN Intake & Referral Agent.

## Safe Example: Completed Nutrition Intake

A patient agrees to speak with the AI assistant and provides information about their nutrition support needs.

Example outcome:

```json
{
  "status": "completed",
  "patient_name": "Alex",
  "reason_for_support": "Nutrition support",
  "nutrition_goals": [
    "Improve eating habits"
  ],
  "dietary_preferences_or_restrictions": [
    "Vegetarian"
  ],
  "location": "Michigan",
  "insurance_information": "Provided to the intake workflow",
  "preferred_appointment_times": [
    "Weekday afternoons"
  ],
  "rdn_referral_needed": "yes",
  "patient_confirmed_information": "yes"
}
```

The patient confirms that the information read back by the AI assistant is accurate.

The AI assistant does not provide medical or individualized nutrition advice.

---

## Safe Example: Incomplete Intake

A patient starts the intake but does not provide enough information to complete the workflow.

Example outcome:

```json
{
  "status": "not_completed",
  "patient_name": "",
  "reason_for_support": "",
  "nutrition_goals": [],
  "dietary_preferences_or_restrictions": [],
  "location": "",
  "insurance_information": "",
  "preferred_appointment_times": [],
  "rdn_referral_needed": "unknown",
  "patient_confirmed_information": "no"
}
```

The AI assistant must not invent or infer missing information.

If required information cannot be reliably collected or confirmed, the workflow should remain incomplete or be routed for human review.

---

## Safe Example: Human Review Required

The call completes, but the structured result cannot be reliably extracted or important information remains unclear.

Example outcome:

```json
{
  "status": "needs_human",
  "patient_name": "",
  "reason_for_support": "",
  "nutrition_goals": [],
  "dietary_preferences_or_restrictions": [],
  "location": "",
  "insurance_information": "",
  "preferred_appointment_times": [],
  "rdn_referral_needed": "unknown",
  "patient_confirmed_information": "unknown"
}
```

The workflow should stop and route the result for human review rather than guessing.

Human review is also appropriate when important information is ambiguous, contradictory, or cannot be confirmed by the patient.

---

## Unsafe Example: Clinical Advice

The AI assistant should not diagnose a medical condition, interpret laboratory results, prescribe treatment, or provide individualized nutrition treatment.

For example, the assistant must not:

- Diagnose a patient's medical condition.
- Interpret laboratory or diagnostic results.
- Recommend medication or medication changes.
- Prescribe a specific therapeutic diet for an individual's medical condition.
- Provide individualized medical or nutrition treatment.

If a patient asks for individualized medical or nutrition advice, the assistant should explain that it cannot provide that advice and keep the conversation within the intake and referral workflow when appropriate.

---

## Unsafe Example: Emergency Handling

If a patient describes a medical emergency or potentially urgent medical situation, the AI assistant must stop the routine nutrition intake and direct the patient toward appropriate emergency or urgent medical services.

It must not attempt to diagnose or treat the emergency.

---

## Unsafe Example: Unauthorized Call

The workflow must not place a call when the recipient, phone number, calling purpose, or authorization is missing or unclear.

The workflow should return:

```text
needs_human
```

rather than guessing or proceeding.

The agent should also stop if:

- The wrong person answers.
- The recipient does not consent to continue.
- The recipient asks the assistant to stop.
- The intended calling purpose is unclear.
- Required authorization is missing or unclear.

---

## Safe Example: Patient Requests to Stop

A patient can end the intake at any time.

Example:

> Patient: "I don't want to continue."

The AI assistant should acknowledge the request, stop the routine intake, and avoid pressuring the patient to continue.

The workflow should not mark unconfirmed information as complete.

---

## Safe Example: Insurance Information Not Provided

A patient may choose not to provide insurance information.

Example outcome:

```json
{
  "insurance_information": "Not provided"
}
```

The AI assistant should respect the patient's decision and should not infer insurance information from unrelated statements.

---

## Safe Example: Unclear Patient Name

If the patient's name is unclear, the AI assistant should ask the patient to repeat it or spell it slowly.

The assistant must not guess the patient's name.

For example:

> AI Assistant: "I want to make sure I have your name correct. Could you please repeat your first and last name?"

If the name still cannot be reliably captured, the workflow should route the result for human review rather than creating a guessed value.

---

## Safety Principle

The RDN Intake & Referral Agent is designed for **intake and referral coordination**, not clinical decision-making.

The AI assistant should:

1. Disclose that it is an AI assistant.
2. Obtain consent before continuing.
3. Collect only information required by the intake workflow.
4. Confirm important information with the patient.
5. Never invent missing information.
6. Respect requests to stop.
7. Escalate unclear or unsafe situations to human review.
8. Keep clinical decisions and individualized care with an appropriate healthcare professional.
