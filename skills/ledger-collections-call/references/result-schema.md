# Result schema

Declare the schema **before** any live `POST /v1/calls`. CALL-E rejects union types such as `"type": ["integer","null"]`. Optional fields are omitted or sent as a plain scalar. Do not add `$ref`, `oneOf`, `anyOf`, or `additionalProperties: true` unless you have verified the current API accepts them.

This skill never writes the result into a ledger. Validate, then hand the object to a human or to another tool (`kept` capture, a merchant UI).

## Task-level `result_schema`

```json
{
  "type": "object",
  "required": ["completed_count"],
  "properties": {
    "completed_count": { "type": "integer" }
  }
}
```

## Recipient `recipient_result_schema`

```json
{
  "type": "object",
  "required": ["outcome"],
  "properties": {
    "outcome": {
      "type": "string",
      "enum": [
        "promised",
        "refused",
        "voicemail",
        "no_answer",
        "wrong_number",
        "callback_requested"
      ]
    },
    "promised_amount_minor": { "type": "integer" },
    "promised_currency": { "type": "string" },
    "promised_date": { "type": "string" },
    "language": { "type": "string", "enum": ["ar", "en"] },
    "acknowledged_hold": { "type": "boolean" },
    "evidence_quote": { "type": "string" }
  }
}
```

`promised_date` is a calendar day `YYYY-MM-DD`, not a datetime.

## Local validation (stricter than transmit)

- `promised_amount_minor` must be an integer with no remainder. `1500` is valid. `1500.5` is invalid. Do not coerce.
- `outcome` values outside the enum are not mapped to `promised`.
- `task_completed` without a collections `outcome` is not a promise. Do not invent an amount.
- A valid integer promise is still **not** a payment.
