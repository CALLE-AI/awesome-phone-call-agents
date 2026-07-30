# Structured Result

The point of an onboarding call is the structured result, not the transcript. Attach a result
schema to the call task so the provider returns typed fields you can write straight into a CRM.

## Schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "business_name":       { "type": "string" },
    "business_type":       { "type": "string", "description": "e.g. Retail Grocery, Restaurant, Office" },
    "goal":                { "type": "string", "description": "Primary reason they signed up" },
    "pain_points":         { "type": "array", "items": { "type": "string" } },
    "used_similar_before": { "type": "boolean" },
    "sentiment":           { "type": "string", "enum": ["Positive", "Neutral", "Confused", "Frustrated", "Angry"] },
    "activation_status":   { "type": "string", "enum": ["Activated", "Interested", "NotInterested", "NeedsHumanFollowUp"] },
    "wants_human_contact": { "type": "boolean" },
    "follow_up_required":  { "type": "boolean" },
    "notes":               { "type": "string" }
  },
  "required": ["sentiment", "activation_status", "follow_up_required"]
}
```

Keep `required` small. A customer may end the call early, and a schema that demands nine fields
from a ninety-second conversation will either fail validation or invite invented values.

## Example (fictional)

A fictional customer answering a fictional onboarding call:

```json
{
  "business_type": "Retail Grocery",
  "goal": "Reach more customers who order online rather than in person.",
  "pain_points": ["Online orders are a small share of total sales."],
  "used_similar_before": false,
  "sentiment": "Positive",
  "activation_status": "NeedsHumanFollowUp",
  "wants_human_contact": true,
  "follow_up_required": true,
  "notes": "Asked for help placing a first order."
}
```

Note what happened in that example: the customer never said the words "needs human follow-up". They
agreed when the agent offered help. The mapping from a spoken "yes, that would be great" to
`wants_human_contact: true` to an assigned task is the entire value of the workflow.

## Enum Design

Prefer closed enums over free text for anything you will filter, count, or route on.

- `sentiment` drives triage. Keep it small; graded scales invite inconsistent labelling.
- `activation_status` drives the funnel. `NeedsHumanFollowUp` is distinct from `Interested`:
  the first is a commitment to act, the second is not.
- Free-text `goal` and `notes` are for humans. Do not build automation on them.

## Ingestion Rules

- Treat webhook delivery as at-least-once. Key writes on the provider event id or your own call id.
- Read the per-recipient structured result first, then fall back to the call-level one.
- An empty or absent structured result means the customer was not reached. Do not coerce it into an
  empty insight row, and do not let it count as an onboarding.
- Store the transcript alongside the fields so a human can audit any extraction they doubt.

## Reporting

Derive activation metrics from calls that produced a structured result, not from calls that reached
a terminal state. Dividing activations by "completed calls" silently inflates the number with calls
that nobody answered.
