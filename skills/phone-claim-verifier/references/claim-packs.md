# Claim packs

A claim pack is a JSON file. It is the only thing you change to point this skill at a new
kind of record - a new domain is a new pack, not new code.

## Format

```json
{
  "pack_id": "healthcare",
  "version": 1,
  "display_name": "Health-plan provider directory",
  "expires_after_days": 90,
  "call_preamble": "You are an automated verification call ... Ask only the questions listed.",
  "claims": [
    {
      "claim_id": "accepts_plan",
      "question": "Does this office currently accept patients covered by the Northline Health plan?",
      "answer_guidance": "yes only if the responder explicitly confirms Northline Health by name. 'We take most major plans' is unknown. no only on an explicit statement that it is not accepted."
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `pack_id`, `version` | identity; together they form the `pack_ref` stamped on every attestation |
| `expires_after_days` | how long an attestation from this pack stays valid (default 90) |
| `call_preamble` | prepended to every call goal - the disclosure, tone, and guardrails |
| `claims[].claim_id` | must match the column name in the records CSV that holds the asserted value |
| `claims[].question` | asked on the call, verbatim; `{address}` is substituted from the record |
| `claims[].answer_guidance` | tells you (and CALL-E's own extractor) how to read yes / no / unknown - be strict about what counts as a yes |

Claims are boolean by default (`yes` / `no` / `unknown`). For a small fixed set of answers,
add `"enum_values": ["morning", "afternoon", "evening"]` to a claim; `unknown` is always added.

## Writing a good pack

- One fact per claim. "Do you accept this plan AND take new patients" is two claims.
- Make `answer_guidance` reject vague answers. The value of this skill is that "we take most
  plans" does not count as confirmation of a specific plan.
- Name the subject of the claim in the question. "Do you accept it" is unresolvable; "Do you
  accept the Northline Health plan" is.
- Use fictional names in the pack and in examples. The bundled pack uses `Northline Health`.

## Example packs to fork

- `examples/healthcare.json` - health-plan provider directory (bundled, runnable)
- a supplier-contact pack: claims like `still_supplies_us`, `contact_name_current`
- a community-services pack: claims like `still_open`, `hours_current`, `location_current`

Each is ~10 lines of JSON. The scripts do not change.
