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