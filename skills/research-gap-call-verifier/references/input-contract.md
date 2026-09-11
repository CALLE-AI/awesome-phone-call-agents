# Input Contract

`build_call_plan.py` accepts one UTF-8 JSON object. Unknown top-level or business fields are rejected so misspellings do not silently remove a safety-relevant value.

## Shape

```json
{
  "schema_version": "1.0",
  "request_id": "wedding-venue-demo",
  "goal": "Find a private room for 30 guests under $4,000.",
  "constraints": ["Friday evening", "Chicago"],
  "businesses": [
    {
      "business_id": "example-venue",
      "name": "Example Venue",
      "published_phone": "+12025550123",
      "source_url": "https://example.com/venue",
      "established_facts": [
        {
          "fact_id": "capacity",
          "statement": "The private room seats 40.",
          "source_url": "https://example.com/venue/private-room"
        }
      ],
      "gaps": [
        {
          "gap_id": "availability",
          "question": "Is the private room available Friday evening for 30 guests?"
        }
      ]
    }
  ]
}
```

## Rules

- `schema_version` must be `1.0`.
- `request_id`, business ids, fact ids, and gap ids use 1 to 64 lowercase letters, digits, or hyphens.
- `goal` is 10 to 300 characters. Each constraint is 1 to 160 characters.
- One plan contains 1 to 5 businesses. Each business contains 1 to 5 gaps.
- `published_phone` must be E.164: a leading `+` followed by 8 to 15 digits. It must be a published organizational line supplied by the operator. Number type and ownership cannot be proved from syntax.
- Each business must carry an `https://` source URL. Every established fact must also cite an `https://` source URL.
- A question is 10 to 240 characters, contains exactly one question mark at the end, and asks one factual question.
- Free text is rejected when it matches the deterministic prohibited-purpose and sensitive-data floor. This floor is intentionally conservative and is not a substitute for host moderation.
- The input must not contain credentials, authentication codes, payment-card or bank-account numbers, government identifiers, dates of birth, medical details, or instructions to impersonate a person. The deterministic floor rejects sensitive-purpose phrases and free-text numeric sequences of 6 to 19 digits; the dedicated `published_phone` field is validated separately.

The builder orders businesses and their facts and gaps by id before hashing, so semantically identical inputs produce the same plan. Changing a recipient, purpose, or question changes the content-bound idempotency key.
