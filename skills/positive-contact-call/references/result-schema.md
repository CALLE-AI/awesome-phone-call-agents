# Result schema

The schema transmitted with the call, the fields that must never appear in it, and the
stricter validation that runs locally after the call returns.

## What is sent

One recipient per call, with a recipient-level result schema. The disposition is read from
the recipient's structured result, not from any task-level result.

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["contact_type", "acknowledged", "needs_assistance"],
  "properties": {
    "contact_type": {
      "type": "string",
      "enum": ["live_person", "voicemail", "no_answer", "busy", "wrong_number", "refused", "language_barrier", "unknown"],
      "description": "Use live_person when a human answered and spoke with you. Use voicemail when an answering machine, voicemail greeting, or automated message answered, even if you left the notice. ..."
    },
    "acknowledged": {
      "type": "string",
      "enum": ["yes", "no", "unknown"],
      "description": "Use yes only when a live human said in their own words that they heard and understood the notice. A voicemail message you left is never yes. ..."
    },
    "spoke_with": {
      "type": "string",
      "enum": ["customer", "household_member", "caregiver", "other", "unknown"]
    },
    "needs_assistance": {
      "type": "string",
      "enum": ["none", "transport", "resource_center_info", "callback_requested", "medical_question", "other", "unknown"]
    },
    "callback_window": { "type": "string" },
    "preferred_language": { "type": "string" },
    "notify_alternate_contact": {
      "type": "string",
      "enum": ["yes", "no", "unknown"]
    },
    "notes_for_human": { "type": "string" }
  }
}
```

## Why it is shaped this way

**String enums, not booleans.** A business decision that might be unclear needs somewhere
to put "I could not tell". A boolean forces a guess, and the guess will be `false` or
`true` with no way to distinguish it from a real answer.

**An `unknown` value on every enum.** A call that never reached anybody still has to
return something. `unknown` says so; any other value would be a fabrication.

**Descriptions carry the selection logic.** Extraction reads the descriptions, so the rule
that separates `voicemail` from `live_person`, and the rule that a message you left is
never an acknowledgement, belong in the description rather than in a comment nobody sends.

**`additionalProperties: false`.** Object schemas are strict by default, and saying so
explicitly means a field that drifts in is rejected rather than quietly stored.

**No `maxLength` on the wire.** Length constraints are not part of the supported schema
subset, and sending one risks the whole call being rejected as an invalid schema. The
bound is stated in the field description and enforced by the local validator instead, so
an over-long field becomes a review item rather than a failed call.

## Field names that must never be used

Reserved recipient response field names collide with the transport's own fields:

`summary`, `status`, `transcript`, `call_id`, `id`, `started_at`, `completed_at`, `phones`

If you need a summary field, name it something else. The schema above deliberately uses
`notes_for_human`.

## No field records a health fact

There is no field for a condition, a device, a diagnosis, a medication, or a treatment,
and none may be added. Enrollment in a medical baseline programme is a tariff flag on the
account and is not a health record.

`notes_for_human` is free text, and its description explicitly instructs against recording
any medical detail, phone number, account number, or email address. Its contents are
redacted before storage outside the contact record.

## Local validation, after the call

Stricter than the wire schema, and run on every returned result before adjudication:

| Check | On failure |
| --- | --- |
| The result is a non-null object | `NEEDS_HUMAN`, reason `recipient_result_invalid` |
| No key outside the declared properties | `NEEDS_HUMAN` |
| No reserved transport field name | `NEEDS_HUMAN` |
| All three required fields present | `NEEDS_HUMAN` |
| Every value is a string | `NEEDS_HUMAN` |
| Every enum value is a member of its enum | `NEEDS_HUMAN` |
| `callback_window` at most 80 characters | `NEEDS_HUMAN` |
| `preferred_language` at most 20 characters | `NEEDS_HUMAN` |
| `notes_for_human` at most 280 characters | `NEEDS_HUMAN` |

A null recipient result means extraction could not produce a schema-valid answer from the
call. That is a review item, never an inferred outcome.
