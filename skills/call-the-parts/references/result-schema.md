# Result Schema

Declare the shape of a valid quote **before** the call. A schema written after the fact will find meaning in noise.

## Transmitted Shape

Put these fields in the CALL-E goal so the provider extracts them. Keep enums closed. Do not send JSON Schema keywords the provider may reject (`minimum`, `maximum`) unless you have checked support.

```json
{
  "type": "object",
  "required": [
    "in_stock",
    "condition_reported",
    "price_spoken",
    "core_charge_spoken",
    "hold_offered",
    "hold_until_spoken",
    "pickup_or_ship",
    "interchange_or_notes",
    "callback_required",
    "outcome"
  ],
  "properties": {
    "in_stock": { "type": "string", "enum": ["yes", "no", "maybe", "unknown"] },
    "condition_reported": { "type": "string" },
    "price_spoken": { "type": "string" },
    "core_charge_spoken": { "type": "string" },
    "hold_offered": { "type": "string", "enum": ["yes", "no", "unknown"] },
    "hold_until_spoken": { "type": "string" },
    "pickup_or_ship": { "type": "string", "enum": ["pickup", "ship", "either", "unknown"] },
    "interchange_or_notes": { "type": "string" },
    "callback_required": { "type": "boolean" },
    "outcome": {
      "type": "string",
      "enum": ["answered", "declined", "no_answer", "voicemail", "unknown"]
    }
  }
}
```

## Local Rules (stricter than transmit)

Run `scripts/validate-quote.mjs` on whatever comes back.

- Drop undeclared fields.
- Refuse out-of-enum values. Do not map `probably` to `maybe` or `yes`.
- Keep prices as spoken text. Do not parse "$80 or 90" into `85`.
- Empty string is allowed for spoken fields when the spare parts shop did not say that thing. Do not invent "none".
- `maybe` routes to a human. It is not stock.
- Missing confidence from the provider counts as low confidence.

## Why Spoken Money

"Eighty, plus core, if it's the 1.8" has no correct numeric reading. Inventing one commits the dealership to a figure nobody said.

## Versioning

Store this schema name (`call-the-parts-quote/v1`) next to the result so a later change cannot pretend an old answer matches a new question.
