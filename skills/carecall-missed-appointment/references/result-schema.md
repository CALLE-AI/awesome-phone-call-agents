# CareCall Result Schema

CareCall uses a structured result schema to convert the AI phone conversation into a predictable appointment recovery outcome.

The CareCall backend uses this result to determine whether an appointment should be rescheduled, declined, or require human follow-up.

## Result Object

```json
{
  "outcome": "RESCHEDULED",
  "patient_confirmed": "YES",
  "follow_up_required": "NO",
  "selected_slot": "SLOT-003",
  "summary": "Patient confirmed their identity, agreed to reschedule, and confirmed the available appointment slot."
}
```

## Fields

* `outcome`: The final outcome of the recovery conversation.
* `patient_confirmed`: Whether the intended patient was successfully verified.
* `follow_up_required`: Whether human or host-system follow-up is required.
* `selected_slot`: The appointment slot selected and confirmed by the patient, or `NONE` when no slot was selected.
* `summary`: A concise summary of the conversation outcome.

## Possible Outcomes

* `RESCHEDULED`: The patient was verified, agreed to reschedule, selected an available slot, and explicitly confirmed the slot.
* `DECLINED`: The patient was verified but declined to reschedule.
* `CALLBACK_REQUESTED`: The patient requested to be contacted later. This does not automatically create another call.
* `NO_ANSWER`: The call was not answered or no usable conversation was completed.
* `WRONG_PERSON`: The intended patient could not be verified.
* `CLINICAL_FOLLOWUP_REQUIRED`: The patient raised a medical concern requiring human or clinical follow-up.
* `SAFETY_ESCALATION`: The conversation indicated an urgent or potentially dangerous situation requiring the host's approved safety process.
* `UNKNOWN`: The conversation did not produce a reliable outcome.

## Slot Rules

* `selected_slot` must contain an appointment slot identifier supplied by the host application.
* `SLOT-003` is an example identifier only.
* The skill must never invent appointment availability or slot identifiers.
* `selected_slot` should be `NONE` when no appointment slot was selected.

## Safety and Execution Rules

* A `RESCHEDULED` result requires explicit patient confirmation of the selected slot.
* A `CALLBACK_REQUESTED` result does not authorize an automatic or recurring callback.
* The host application is responsible for duplicate prevention, cancellation, scheduling, and authorization of real-world calls.
* The result must not be used to provide medical advice or make clinical decisions.
