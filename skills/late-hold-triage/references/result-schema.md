# Result schema

`late-hold-triage` sends this `result_schema` on `POST /v1/calls` so
CALL-E returns fields the decision rule can read without a second model.

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": ["answered", "no_answer", "voicemail", "unclear"]
    },
    "still_coming": {
      "type": "boolean",
      "description": "True only if the guest clearly said they are still coming. False if they released the slot. Omit when status is not answered."
    },
    "eta_minutes": {
      "type": "integer",
      "minimum": 0,
      "description": "Minutes the guest said they need to arrive. Required when still_coming is true. Omit when they released the slot or gave no number."
    },
    "released": {
      "type": "boolean",
      "description": "True only if the guest clearly gave the slot back."
    },
    "confirmation_quote": {
      "type": "string",
      "description": "A short span of the guest's own words. Do not invent one."
    }
  },
  "required": ["status"]
}
```

## Task template

```text
You are an automated assistant calling on behalf of {business_name}.
The guest is {guest_name}. Their booking ({context}) started at
{slot_start_human}. The house can hold it until {hold_until_human}.
Disclose that you are an AI assistant. Ask only: are they still coming,
and if so how many minutes until they arrive. If they are not coming,
confirm they are releasing the slot. Do not discuss medical, legal, or
payment details. Do not offer another time. Do not call anyone else.
Fill status, still_coming, eta_minutes, released, and confirmation_quote
from words the guest actually spoke. If they said "soon" without a
number, leave eta_minutes empty and set status to unclear.
```

## Region inference

If `region` is omitted, infer it from the E.164 country code using this
static map (the set CALL-E documents, plus KR):

`1` US (CA must be set explicitly), `65` SG, `60` MY, `91` IN, `971` AE,
`61` AU, `44` GB, `84` VN, `49` DE, `81` JP, `33` FR, `52` MX, `55` BR,
`62` ID, `63` PH, `254` KE, `82` KR.

An unmapped country code stops the live path and asks for an explicit
`region`. It is never guessed from the guest's name.

## Decision mapping

| Structured fields | Clock | Decision |
|---|---|---|
| `still_coming=true`, `eta_minutes` <= remaining hold | hold still open | `KEEP_HOLD` |
| `still_coming=true`, `eta_minutes` > remaining hold | hold still open | `RELEASE_NOW` |
| `released=true` or `still_coming=false` | hold still open | `RELEASE_NOW` |
| `no_answer` / `voicemail` / `unclear` / missing ETA on a yes | hold still open | `NEEDS_HUMAN` |
| (any) | `now >= hold_until` | `HOLD_EXPIRED` (no call) |
