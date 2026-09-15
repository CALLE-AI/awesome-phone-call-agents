# Result schema

Every live CALL-E call must include a `result_schema` on create. The server wraps the canonical
envelope and adds typed `facts` properties per archetype.

## Canonical envelope (always sent)

```json
{
  "type": "object",
  "required": ["outcome", "summary_for_user"],
  "properties": {
    "outcome": {
      "type": "string",
      "enum": ["resolved", "needs_human", "voicemail", "unavailable", "refused", "failed"]
    },
    "summary_for_user": { "type": "string" },
    "facts": { "type": "object" },
    "next_step": { "type": "string" },
    "callee_role": { "type": "string" }
  }
}
```

`outcome` is a controlled vocabulary. Pick the closest fit:

- **`resolved`** — the goal was achieved. Caller has the answer.
- **`needs_human`** — the callee asked for a commitment, OTP, or human voice. The brief is the
  caller's "you need to take over" handoff.
- **`voicemail`** — reached voicemail, no human. Caller should retry or move on.
- **`unavailable`** — no answer, busy, or rejected.
- **`refused`** — the callee declined to engage (e.g. "we don't do that").
- **`failed`** — transport / API error. `summary_for_user` should include the error message.

`summary_for_user` must always be a single complete sentence — the user's first read of the
brief. Never include placeholder text.

## Per-archetype `facts`

The server adds these typed properties per archetype:

### courier

```json
"facts": {
  "tracking_number": "AWB 8821",
  "status": "Out for delivery",
  "expected_time": "4 PM today",
  "rider_contact": "+91 98765 43210"
}
```

### clinic

```json
"facts": {
  "appointment_time": "4:30 PM tomorrow",
  "doctor_name": "Dr. Mehta",
  "prep_instructions": "Bring prior test reports",
  "insurance_required": false
}
```

### restaurant

```json
"facts": {
  "reservation_time": "7:30 PM tonight",
  "party_size": 2,
  "wait_minutes": 15,
  "dietary_accommodations": "Vegetarian corner table"
}
```

### utility

```json
"facts": {
  "account_number": "...",
  "service_type": "Power outage",
  "reference_number": "REF-12345",
  "next_action_by_user": "Wait for SMS update by 6 PM"
}
```

### general

```json
"facts": {
  "key_facts": { "...": "..." }
}
```

If the archetype doesn't fit the call exactly, use `general` and put free-form keys in `facts.key_facts`.
