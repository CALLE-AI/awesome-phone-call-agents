# CareCall Examples

These examples show representative structured outcomes for the missed appointment recovery workflow.

## Successful Rescheduling

The patient is verified, agrees to reschedule, selects an available slot, and explicitly confirms the selected slot.

```json
{
  "outcome": "RESCHEDULED",
  "patient_confirmed": "YES",
  "follow_up_required": "NO",
  "selected_slot": "SLOT-003",
  "summary": "Patient confirmed the available replacement appointment."
}
```

## Patient Declines

The patient is verified but does not want to reschedule.

```json
{
  "outcome": "DECLINED",
  "patient_confirmed": "YES",
  "follow_up_required": "NO",
  "selected_slot": "NONE",
  "summary": "Patient declined to reschedule."
}
```

## Callback Requested

The patient asks to be contacted later. A callback request does not automatically create another call.

```json
{
  "outcome": "CALLBACK_REQUESTED",
  "patient_confirmed": "YES",
  "follow_up_required": "YES",
  "selected_slot": "NONE",
  "summary": "Patient requested a later callback. The host system must decide whether and when to create another recovery attempt."
}
```

## Important Notes

* `selected_slot` must contain a slot identifier supplied by the host application.
* `SLOT-003` is an example identifier only.
* The skill must never invent appointment slots or slot identifiers.
* `RESCHEDULED` requires patient verification, agreement to reschedule, selection of an available slot, and explicit confirmation.
* `CALLBACK_REQUESTED` does not authorize unlimited, recurring, or automatic calls.
* The host application is responsible for duplicate prevention, cancellation, scheduling, and real-world call authorization.
