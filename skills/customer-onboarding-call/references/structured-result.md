# Structured Result

The point of an onboarding call is the structured result, not the transcript. Attach a result
schema to the call task so the provider returns typed fields you can write straight into a CRM.

## Schema

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "consent_granted":            { "type": "boolean", "description": "Did a human agree to continue at the consent checkpoint. Only meaningful when a human took part; false on NotReached because nobody was there to grant it." },
    "disposition":                { "type": "string", "enum": ["Completed", "EndedEarly", "Declined", "DoNotCall", "NotReached"] },
    "disposition_evidence":       { "type": "string", "description": "What the customer actually said that supports the disposition. Quote or close paraphrase. Never inferred from tone or silence." },
    "callback_consent":           { "type": "boolean", "description": "Did the customer explicitly ask to be called back. Required before any redial after a conversation." },
    "callback_consent_evidence":  { "type": "string", "description": "The customer's own words requesting a callback, with any time or window they gave." },
    "business_name":         { "type": "string" },
    "business_type":         { "type": "string", "description": "e.g. Retail Grocery, Restaurant, Office" },
    "goal":                  { "type": "string", "description": "Primary reason they signed up" },
    "pain_points":           { "type": "array", "items": { "type": "string" } },
    "used_similar_before":   { "type": "boolean" },
    "sentiment":             { "type": "string", "enum": ["Positive", "Neutral", "Confused", "Frustrated", "Angry"] },
    "activation_status":     { "type": "string", "enum": ["Activated", "Interested", "NotInterested", "NeedsHumanFollowUp"] },
    "wants_human_contact":   { "type": "boolean" },
    "follow_up_required":    { "type": "boolean" },
    "notes":                 { "type": "string" }
  },
  "required": ["consent_granted", "disposition", "disposition_evidence"]
}
```

The three required fields are the safety fields, not the analysis fields. A result is worthless —
and dangerous — if you cannot tell whether the customer agreed to take part, so consent and
disposition must always be present even when discovery collected nothing.

Everything else is optional by design. A customer may end the call after ten seconds, and a schema
that demands nine analysis fields from a ninety-second conversation will either fail validation or
invite invented values. `sentiment` and `activation_status` are only meaningful when `disposition`
is `Completed`; treat them as absent otherwise.

## Consent and disposition

`disposition` is the field the outcome classification in `SKILL.md` is built on. Define it for the
model precisely:

| Value | Meaning |
| --- | --- |
| `Completed` | The customer consented and the conversation ran to its natural end. |
| `EndedEarly` | The customer consented, then the call ended before wrap-up — hung up, cut off, or asked to stop partway. |
| `Declined` | The customer refused at the consent checkpoint, or asked to end the call. |
| `DoNotCall` | The customer asked not to be contacted again. Broader than `Declined`: it suppresses all outbound calling to the number across every workflow, not just this onboarding run. See *Suppression scope* in `SKILL.md`. When you cannot tell which the customer meant, record `DoNotCall`. |
| `NotReached` | The extractor believes no human took part. **Corroborating only** — it is a model claim about the call, not an observation of it, and the same extractor mislabels refusals. It may support observed voicemail, carrier, ring-out, no-answer, or silence evidence; on its own it yields `needs-review`, never a retry. |

`disposition_evidence` must contain what the customer actually said. It exists so a human can audit
a refusal that was recorded as consent, or a consent that was recorded as a refusal. Reject a
result whose disposition is `Completed` but whose evidence does not show agreement — an empty or
generic evidence string is a validation failure, not a formatting problem.

Do not infer consent from silence, from the customer continuing to answer questions, or from a
warm tone. Infer it only from an affirmative answer at the consent checkpoint.

### `consent_granted` is not a refusal signal on its own

`consent_granted` is `false` on a `NotReached` result, because a voicemail cannot grant consent.
That is an absence of consent, not a refusal.

Treating `consent_granted: false` as a refusal on its own turns every unanswered call into a
permanent do-not-call, silently destroying reachable customers. The field is only evaluated once a
human is known to have taken part — Stage B in `SKILL.md`. Stage A never reads it.

## Precedence

Classification runs in two stages: **was a human reached**, then **did they consent**. Never merge
them into one ordered list — that is what makes a no-answer look like a refusal.

Within Stage B, `declined` outranks the presence of a result. A call can produce a complete,
well-formed structured result and still be a refusal — the agent asks its consent question, the
customer says "no, take me off your list", and the provider returns a populated object anyway.

Never classify on the analysis fields. See the staged tables in `SKILL.md`.

## Callback consent

`callback_consent` governs whether the customer may be called again after a conversation. It is
separate from `consent_granted`, which only covers the call in progress.

Set it `true` only when the customer asked to be called back in their own words, captured in
`callback_consent_evidence`, along with any time or window they specified. An unfinished answer, a
polite goodbye, or a dropped line is not a callback request.

A `partial` call carries no implicit permission to redial. The customer may have ended the call
precisely because they did not want to continue, and nothing in the transcript distinguishes that
from a dropped connection.

## Example (fictional)

A fictional customer answering a fictional onboarding call:

```json
{
  "consent_granted": true,
  "disposition": "Completed",
  "disposition_evidence": "Asked if now was a good time, customer said 'yes, that's fine', and stayed to the end of the call.",
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

A refusal, which must never become an onboarding no matter how much else the model fills in:

```json
{
  "consent_granted": false,
  "disposition": "DoNotCall",
  "disposition_evidence": "Customer said 'no, please don't call me about this' at the consent question.",
  "business_type": "Retail Grocery",
  "sentiment": "Neutral"
}
```

Note that the second example still carries `business_type` — the provider inferred it from the
signup context. Classifying on the presence of a result would treat this refusal as an onboarding
and create a follow-up task for someone who just asked to be left alone. Classifying on
`disposition` does not.

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

- Treat webhook delivery as at-least-once. Key writes on the provider event id, and key attempts on
  `(signup_id, attempt_no)`, so redelivery cannot advance state twice.
- Read the per-recipient structured result first, then fall back to the call-level one.
- **Classify before you write.** Run Stage A, then Stage B, using the tables in `SKILL.md`, then
  write only what that outcome permits.
- **An empty or absent structured result does not mean the customer was not reached.** Extraction
  can fail, validation can reject the result, and a customer who refuses may ring off before the
  model emits anything. Decide reachability from call evidence — a provider answered-by-human
  signal, or customer speech in the transcript that is not carrier audio — and send a reached call
  with no usable result to `needs-review`. Treating it as `not-reached` queues an automatic retry
  and can redial someone who just refused.
- Never coerce a missing result into an empty insight row, and never let one count as an onboarding.
- **A result missing or malforming `disposition`, `consent_granted`, or `disposition_evidence` is
  `needs-review`, not `not-reached`.** `not-reached` queues an automatic retry, so coercing a
  malformed record into it can redial someone who actually refused. Route it to a human instead.
- Apply the same rule when the evidence contradicts the disposition, for example `Completed` with
  evidence showing a refusal. Contradiction is a review trigger, never a classification to resolve
  by calling the customer again.
- When you cannot determine whether a human took part, treat the call as reached and send it to
  review. An unnecessary manual check costs a minute; an unwanted redial costs a customer.
- A later result must never overwrite a `Declined` or `DoNotCall` disposition already on record.
  Refusals are terminal for the signup.
- Store the transcript alongside the fields so a human can audit any extraction they doubt,
  especially the disposition.

## Reporting

Derive activation metrics from calls that produced a structured result, not from calls that reached
a terminal state. Dividing activations by "completed calls" silently inflates the number with calls
that nobody answered.
