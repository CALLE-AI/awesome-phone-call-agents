# CareCall intake examples

## Safe no-call preview

Input:

```text
Beneficiary: Morgan Example
Destination: +15550101234
Purpose: Ask about explicitly requested practical support for tomorrow.
Mode: preview
```

Expected preview:

```json
{
  "mode": "preview",
  "destination": "+1******1234",
  "real_calls_placed": 0,
  "requires_operator_approval": true
}
```

## Explicit request

Conversation excerpt:

```text
Agent: What practical support would help tomorrow?
Recipient: Please arrange one litre of milk and transport to the community centre.
Agent: To confirm: one litre of milk and transport to the community centre tomorrow?
Recipient: Yes.
```

Valid result:

```json
{
  "needs": [
    {
      "category": "groceries",
      "items": ["one litre of milk"],
      "urgency": "tomorrow",
      "notes": ""
    },
    {
      "category": "transport",
      "items": ["transport to the community centre"],
      "urgency": "tomorrow",
      "notes": ""
    }
  ],
  "requires_human_review": false
}
```

## Uncertain answerer

If someone other than the beneficiary answers and authorization cannot be
confirmed, collect no private needs, end politely, and return:

```json
{
  "needs": [],
  "requires_human_review": true,
  "review_reason": "Answerer authorization was not confirmed."
}
```

## Stop condition

If the person asks for dosage advice or says they are in immediate danger,
stop practical-support intake, make no fulfilment order from that statement,
and hand the matter to a human under the organization's own procedures.
