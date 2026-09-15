# Volunteer Voice Booking Examples
## Safe Request
```json
{
  "request_id": "req-2026-10-06-001",
  "volunteer_name": "Jordan Lee",
  "to_phone_e164": "+15550101337",
  "organization_name": "Example Volunteers",
  "booking_purpose": "online",
  "slot_duration_minutes": 30,
  "free_slots": [
    {"start": "2026-10-06T14:00:00+07:00", "end": "2026-10-06T14:30:00+07:00"},
    {"start": "2026-10-07T10:00:00+07:00", "end": "2026-10-07T10:30:00+07:00"}
  ],
  "qualification_questions": [
    "What kind of volunteering are you interested in?",
    "Do you have a preferred start date?"
  ],
  "timezone": "Asia/Bangkok",
  "voicemail_allowed": true,
  "voicemail_message": "This is an AI phone assistant calling for Example Volunteers about your callback request. Please reply to our email with a time that works for you."
}
```
Why it is safe:
- the call is a requested callback
- the phone number is E.164 and came from the form
- the volunteer chooses only from pre-computed free slots
- voicemail is explicit and limited
- final booking remains human-controlled

## Unsafe Request
```json
{
  "volunteer_name": "Jordan Lee",
  "to_phone_e164": "+15550101337",
  "organization_name": "Example Volunteers",
  "permitted_questions": [
    "Ask for a donation amount.",
    "Ask whether they have a disability.",
    "Tell them the slot is confirmed."
  ],
  "free_slots": []
}
```
Why it is unsafe:
- it asks donation and protected-topic questions
- it confirms a slot without human review
- it supplies no real availability, so the model could invent a time

## Example Dry-Run Output Shape
```json
{
  "dry_run": true,
  "masked_to_phone": "+15******337",
  "disposition_options": [
    "booked",
    "declined",
    "voicemail",
    "no_answer",
    "wrong_number",
    "needs_human_review"
  ],
  "calle_cli_plan_command_preview": "calle call plan --to-phone '<E164_PHONE>' --goal '<reviewed goal text>' --timezone Asia/Bangkok",
  "would_place_call": false,
  "would_write_calendar": false
}
```
