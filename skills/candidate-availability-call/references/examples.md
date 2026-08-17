# Candidate Availability Call Examples

## Safe Request

```json
{
  "request_id": "req-2026-10-06-001",
  "candidate_name": "Jordan Lee",
  "to_phone_e164": "+15550101337",
  "role_label": "Product Engineer technical interview",
  "company_name": "Example Robotics",
  "coordinator_name": "Avery Chen",
  "authorized_contact_reason": "Jordan opted into phone coordination for this interview loop.",
  "interview_duration_minutes": 45,
  "allowed_windows": [
    {"start": "2026-10-06T14:00:00-04:00", "end": "2026-10-06T17:00:00-04:00"},
    {"start": "2026-10-07T10:00:00-04:00", "end": "2026-10-07T12:00:00-04:00"}
  ],
  "timezone": "America/New_York",
  "followup_channels": ["email", "sms"],
  "voicemail_allowed": true,
  "voicemail_message": "This is an AI phone assistant calling for Example Robotics about interview scheduling. Please reply to Avery's email with your availability."
}
```

Why it is safe:

- the purpose is scheduling only
- the call is authorized
- the phone number is E.164
- the candidate chooses from coordinator-supported windows
- voicemail is explicit and limited
- final scheduling remains human-controlled

## Unsafe Request

```json
{
  "candidate_name": "Jordan Lee",
  "to_phone_e164": "+15550101337",
  "role_label": "Engineering interview",
  "company_name": "Example Robotics",
  "permitted_questions": [
    "Ask for salary expectations.",
    "Ask whether they have children.",
    "Ask whether they can legally work in the country without sponsorship.",
    "Tell them the interview is confirmed for Tuesday."
  ]
}
```

Why it is unsafe:

- it asks screening and protected-topic questions
- it tries to confirm an interview without human review
- it lacks explicit authority and allowed scheduling windows

## Example Dry-Run Output Shape

```json
{
  "dry_run": true,
  "masked_to_phone": "+15******337",
  "disposition_options": [
    "available",
    "unavailable",
    "voicemail",
    "no_answer",
    "wrong_number",
    "declined",
    "needs_human_review"
  ],
  "calle_cli_plan_command_preview": "calle call plan --to-phone '<E164_PHONE>' --goal '<reviewed goal text>'",
  "would_place_call": false
}
```
