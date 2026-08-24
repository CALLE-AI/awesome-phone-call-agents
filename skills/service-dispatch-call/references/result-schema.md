# Result Schema

Declare the shape of a valid answer **before** placing the call. A schema written after the fact is a parser, and a parser will find meaning in noise.

## Minimal Dispatch Schema

```json
{
  "type": "object",
  "properties": {
    "available": { "type": "string", "enum": ["yes", "no", "maybe"] },
    "earliest_eta_hours": { "type": "integer" },
    "quoted_amount_text": { "type": "string" },
    "callback_required": { "type": "boolean" }
  },
  "required": ["available"]
}
```

Only `available` is required. A vendor who says "yes, but I need to see it before quoting" has given a complete, useful answer with no price in it.

## Closed Sets Over Free Text

Every field whose value drives a downstream branch must be an enum.

- Good: `available` is one of `yes`, `no`, `maybe`.
- Bad: `availability_notes` as a free string that some later step keyword-matches for "can".

Free text is acceptable only where the value is carried to a human unchanged, which is why `quoted_amount_text` is a string. The agent must not parse it into a number. "Thirty-five, maybe forty if the valve's seized" has no correct numeric reading, and inventing one commits the caller to a figure nobody said.

## Validate More Strictly Than You Transmit

Local validation and transmitted schema are not the same document.

`earliest_eta_hours` should be bounded: an ETA of `-5` or `100000` is a transcription artifact, not an answer. But bounds keywords such as `minimum` and `maximum` may not appear in a given provider's supported schema subset, and an unrecognized keyword can cause the provider to reject the entire call rather than ignore the keyword.

So:

1. Keep the strict schema locally and enforce it on the returned result.
2. Strip locally-enforced keywords before transmission.
3. Check the provider's published schema support rather than assuming full JSON Schema.

Failing a local bound is a validation failure, which routes to a human. It is not a reason to clamp the value.

## Validation Rules On The Returned Result

- **Drop undeclared fields.** If the provider returns a key the schema did not declare, discard it. Do not persist it "just in case". You did not ask the question, so you cannot interpret the answer.
- **Refuse out-of-enum values.** If `available` comes back as `probably`, that is a validation failure. Do not map it to `maybe`. Do not map it to `yes`.
- **Partial validity is normal.** A result where `available` is valid but `earliest_eta_hours` failed is still useful. Store what validated, mark what did not, and say so in the output.
- **Distinguish "call connected but produced nothing usable" from "call did not connect."** They have different remedies and should be separately findable.

## Confidence

Where the provider reports a confidence score for the structured extraction, treat a missing or null score as low confidence, not as high.

A configurable threshold, commonly around `0.7`, should route the result to a human. The threshold protects against a confidently-formatted answer to a question the vendor did not actually understand.

## Schema Versioning

Store the schema, or a hash of it, alongside the result.

Six months later the schema will have changed, and a stored result that cannot be matched to the question it answers is not evidence of anything.
