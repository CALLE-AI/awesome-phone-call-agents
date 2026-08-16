# Result Schema

Declare the shape of a valid lead result **before** placing the call. A schema written after the fact is a parser, and a parser will find meaning in noise.

## Schema

```json
{
  "type": "object",
  "properties": {
    "consent_granted":      { "type": "boolean", "description": "Did the caller agree to continue after the opening. False on not-reached, because nobody was there to grant it." },
    "disposition":          { "type": "string", "enum": ["Completed", "EndedEarly", "Declined", "DoNotCall", "NotReached"] },
    "disposition_evidence": { "type": "string", "description": "What the caller actually said that supports the disposition. Quote or close paraphrase, never inferred from tone or silence." },
    "lead_intent":          { "type": "string", "enum": ["Booking", "Quote", "Support", "Information", "WrongNumber", "NotInterested"] },
    "need_summary":         { "type": "string", "description": "One sentence describing what the caller wanted." },
    "urgency":              { "type": "string", "enum": ["Emergency", "Urgent", "Normal", "Flexible"] },
    "callback_slot":        { "type": "string", "description": "The time the caller asked for, as spoken. Never parsed into a timestamp by the agent." },
    "wants_booking":        { "type": "boolean" },
    "notes":                { "type": "string" }
  },
  "required": ["consent_granted", "disposition", "disposition_evidence"]
}
```

The three required fields are the safety fields, not the lead fields. A result is worthless — and dangerous — if you cannot tell whether the caller agreed to take part. Consent and disposition must be present even when qualification collected nothing.

## Closed Sets Over Free Text

Every field that drives a downstream branch is an enum.

- Good: `lead_intent` is one of `Booking`, `Quote`, `Support`, `Information`, `WrongNumber`, `NotInterested`.
- Bad: `intent_notes` as free text that a later step keyword-matches for "book".

Free text is acceptable only where the value is carried to a human unchanged. `callback_slot` is a string for the same reason `quoted_amount_text` is in `service-dispatch-call`: "tomorrow morning, maybe before noon" has no correct machine reading, and inventing one commits the business to a time nobody agreed to.

`Emergency` urgency is a stop condition, not a branch. It ends the call and flags the event; see [`safety.md`](safety.md).

## Validate More Strictly Than You Transmit

Local validation and the transmitted schema are not the same document. Bounds and strict enums are enforced locally on the returned result; strip locally-enforced keywords before transmission, because an unrecognized keyword can cause the provider to reject the entire call. Check the provider's published schema support rather than assuming full JSON Schema.

## Validation Rules On The Returned Result

- **Drop undeclared fields.** If the provider returns a key the schema did not declare, discard it. You did not ask the question, so you cannot interpret the answer.
- **Refuse out-of-enum values.** `lead_intent` returning `maybe` is a validation failure. Do not map it to `Information`. Do not map it to `Booking`.
- **Partial validity is normal.** A result with valid `disposition` but failed `lead_intent` still posts `urgency: unknown` honestly. Store what validated, mark what did not, and say so in the dashboard payload.
- **Missing consent or disposition fields make the whole result `needs-review`**, regardless of how rich the lead fields look. A refusal can carry a beautifully-formed structured result.
- **Distinguish "call connected but produced nothing usable" from "call did not connect."** They have different remedies and must be separately findable.

## Dashboard Payload Permitted By Outcome

| Outcome | Lead fields posted |
| --- | --- |
| `recovered` | `lead_intent`, `need_summary`, `urgency`, `callback_slot`, `wants_booking`, `notes` |
| `partial` | only the fields that validated, with `partial: true` |
| `declined` | none; only the outcome and suppression state |
| `not-reached` | none; only the outcome and retry decision |
| `needs-review` | none; only the outcome and the blocker reason |

Store the schema, or a hash of it, alongside the result so a stored result can always be matched to the question it answered.
