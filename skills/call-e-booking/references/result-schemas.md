# CALL-E Result Schemas

CALL-E's `result_schema` parameter accepts a standard JSON Schema (draft-07 compatible) describing the object you want back. The `structured_result` field in the response is `null` when CALL-E could not produce a schema-valid result (or no schema was supplied), otherwise it is the validated object.

Use these schemas to make CALL-E return data you can drop straight into a calendar event — no transcript parsing.

## Restaurant booking

```json
{
  "type": "object",
  "required": ["booked", "date", "time", "party_size", "restaurant_name"],
  "properties": {
    "booked": {"type": "boolean", "description": "True if the reservation was successfully made"},
    "date": {"type": "string", "description": "Reservation date, YYYY-MM-DD"},
    "time": {"type": "string", "description": "Reservation time, HH:MM 24-hour, business local time"},
    "party_size": {"type": "integer", "description": "Number of people"},
    "restaurant_name": {"type": "string"},
    "confirmation_number": {"type": "string", "description": "Booking reference/confirmation number, if given"},
    "notes": {"type": "string", "description": "Any caveats or special notes"},
    "timezone_offset": {"type": "string", "description": "UTC offset of the business, e.g. -04:00 or +02:00, if extractable from the call"}
  }
}
```

## Medical appointment

```json
{
  "type": "object",
  "required": ["booked", "date", "time", "provider_name", "appointment_type"],
  "properties": {
    "booked": {"type": "boolean", "description": "True if the appointment was successfully made"},
    "date": {"type": "string", "description": "Appointment date, YYYY-MM-DD"},
    "time": {"type": "string", "description": "Appointment time, HH:MM 24-hour, clinic local time"},
    "provider_name": {"type": "string", "description": "Doctor / clinic / provider name"},
    "clinic_address": {"type": "string"},
    "appointment_type": {"type": "string", "description": "e.g. GP visit, dental cleaning, physiotherapy"},
    "confirmation_number": {"type": "string", "description": "Booking reference/confirmation number, if given"},
    "notes": {"type": "string", "description": "Any caveats or special notes"},
    "timezone_offset": {"type": "string", "description": "UTC offset of the clinic, e.g. -04:00 or +02:00, if extractable from the call"}
  }
}
```

## Mapping structured result → calendar event (gws)

Translate the returned object into a `gws calendar create` call. The `date` and `time` are **business-local**, not user-local. Use `timezone_offset` from the structured result when available:

```bash
# If timezone_offset is present (e.g. "-04:00" for US Eastern):
$PY $GAPI calendar create \
  --summary "Reservation at <restaurant_name>" \
  --start "<date>T<time>:00<timezone_offset>" \
  --end "<date>T<end_time>:00<timezone_offset>" \
  --location "<restaurant_name>" \
  --attendees "you@email.com"

# Fallback: derive from the phone's area code (+1 917 → America/New_York, +27 → Africa/Johannesburg)
```

The `google-workspace` skill enforces ISO 8601 with a timezone offset — never emit a UTC-only (`Z`) event unless the booking is genuinely UTC. Google renders the event in the user's timezone automatically.

## Cross-timezone example (verified live)

A US restaurant (`+1 917`, America/New_York, `-04:00`) was booked by a South African user (SAST, `+02:00`):

- CALL-E returned: `date: "2026-08-19"`, `time: "09:00"` (business-local = 09:00 EDT)
- Written to calendar as: `2026-08-19T09:00:00-04:00`
- Google Calendar rendered the event at **15:00 SAST** for the user automatically
