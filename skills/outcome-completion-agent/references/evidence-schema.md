# The evidence schema

Every call in an outcome run fills in the same structure. That is what makes calls
composable: the planner reads a uniform record rather than a transcript, so a call to a
supplier and a call to a depot are the same kind of input.

Pass it as `recipient_result_schema` on `POST /v1/calls`.

```json
{
  "type": "object",
  "required": ["verdict"],
  "properties": {
    "reached": {
      "type": "string",
      "enum": ["yes", "no", "unknown"],
      "description": "yes only if a person actually spoke with you. no if nobody did. unknown if you cannot tell."
    },
    "verdict": {
      "type": "string",
      "enum": ["no_answer", "refused", "blocked", "partial", "offer", "confirmed"],
      "description": "no_answer if nobody picked up. refused if they declined to help. blocked if they cannot do it and named an obstacle. partial if you learned something but the objective is unmet. offer if they proposed something concrete. confirmed if the objective is now met and they committed to it."
    },
    "facts": {
      "type": "array",
      "items": {"type": "string"},
      "description": "Short statements of what the person actually said. Do not infer, summarise or add anything they did not say. Empty if nothing was said."
    },
    "blockers": {
      "type": "array",
      "items": {"type": "string"},
      "description": "Reasons given for why the objective cannot be met here. Empty if none."
    },
    "referrals": {
      "type": "array",
      "description": "Other organisations or departments they told you to contact, with the number they gave. Empty if none were offered. Never invent a number.",
      "items": {
        "type": "object",
        "required": ["org_name"],
        "properties": {
          "org_name": {"type": "string", "description": "Who they told you to call."},
          "phone": {"type": "string", "description": "The number they read out, in E.164 such as +447700900123. Empty string if they did not give one."},
          "role": {"type": "string", "description": "What that organisation does."},
          "reason": {"type": "string", "description": "Why they sent you there."}
        },
        "additionalProperties": false
      }
    },
    "offer": {
      "type": "object",
      "description": "A concrete proposal, if one was made. Leave every field empty if none was.",
      "properties": {
        "what_is_offered": {"type": "string", "description": "What they proposed, in a few words. Empty string if they proposed nothing."},
        "price": {"type": "string", "description": "The total amount only, digits and decimal point, such as 438.00. No currency symbol. Empty string if no price was quoted."},
        "currency": {"type": "string", "description": "Three-letter code such as USD. Empty string if not stated."},
        "eta": {"type": "string", "description": "The date they committed to, as YYYY-MM-DD. Empty string if no date was given."},
        "reference": {"type": "string", "description": "Any reference, order or booking number they gave. Empty string if none."}
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false
}
```

## Three CALL-E schema rules

These rules come from CALL-E's calls guide and are worth checking before you write your
own schema.

**1. A `type` is one value.** `{"type": ["object", "null"]}` is the natural way to say
"this field is optional" and it is legal JSON Schema, but CALL-E accepts only one
supported type per field.

The supported list is `object`, `string`, `number`, `integer`, `boolean`, `array` — one
of them, not a union. `oneOf`, `anyOf` and `allOf` are also unsupported, and a union type
is those in shorthand. **Express absence with an empty string or an empty array**, never
with `null`.

**2. Some field names are reserved.** `summary`, `status`, `transcript`, `call_id` and
timing fields are reserved recipient response names. This schema says `what_is_offered`
because `summary` is not available.

**3. The result is all or nothing.** From the guide: "If CALL-E cannot produce a
schema-valid result from the evidence, the public `structured_result` is `null`." Not
partially filled — absent. So every field you mark `required` is a field that can throw
away the whole call.

That is why `required` here holds one entry. A caller who comes back with a clear verdict
and nothing quotable should still give you the verdict; requiring `facts` as well would
trade a partial answer for no answer at all.

For the same reason, **prices and dates are strings**. A number has no way to say "they
never quoted one", and `0` is a lie that a budget check would happily accept.

## The six verdicts

The enum is small on purpose. Each value maps to a different next move, and a verdict that
does not change what the planner does next does not deserve to exist.

| Verdict | What it means | What the planner does |
|---|---|---|
| `no_answer` | Nobody picked up | Retry once, under the per-party cap, then move on |
| `refused` | They declined to engage | Do not call back. Take any referral and move on |
| `blocked` | They would help but cannot, and said why | Record the blocker, take the referral, move on |
| `partial` | Something learned, objective unmet | Record it; usually move on |
| `offer` | A concrete proposal | Evaluate against constraints |
| `confirmed` | Objective met and committed to | Resolved, if this was an approved commit call |

## Parse it defensively

This is the least trustworthy input in the system: a model's reading of a phone
conversation, filled in under time pressure by a caller who may have been talked over. The
loop must not crash on it, and — more importantly — must not quietly invent the missing
half.

- **A price you cannot read is unknown, never zero.** Accept `"438"`, `"438.00"`,
  `"$438.00"`, `"USD 1,438"` and a bare number if one arrives anyway. Anything else is
  absent. Guessing `0` sails a quote straight past a budget ceiling.
- **A referral without a valid E.164 number is dropped.** See the Following A Referral
  section of `SKILL.md`.
- **A call the provider did not complete is never testimony.** If the CALL-E call status is
  `failed` or `canceled`, treat it as `no_answer` whatever the structured block says. A
  half-connected call can return a confidently filled-in result.
- **An empty `offer` object is not an offer.** Require at least a description, a price, or
  a date.
- **`reached: "no"` overrides the verdict**, and `"unknown"` does not. A call that cannot
  say whether it reached anyone has not established that it did not.

## Validate the schema before you dial

CALL-E validates `recipient_result_schema` at call-creation time. Validate the documented
subset offline before attempting any call.

`scripts/check_evidence_schema.py` checks a returned result. For the schema itself, check
it against the documented subset before the first call: single `type` values, no
`$ref`/`oneOf`/`anyOf`/`allOf`, `additionalProperties: false` on every object, every
`required` name present in `properties`, `items` on every array, and no reserved names at
the top level.

## Why not just read the transcript

A transcript is not a decision input. It is long, it is unstructured, and every planner
that reads one ends up re-deriving the same six facts with a second model call. Worse, it
cannot be replayed: a scripted transcript and a real one differ enough that a run you
rehearse offline is not the run that happens on the phone.

Filling a fixed schema on the call, while the person is still there to be asked, is both
cheaper and more accurate — and it means the planner is testable without a phone.
