# Result schemas

Every workflow returns the same envelope with a different per-claim item:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["call_outcome", "claims", "reference_number", "representative_name"],
  "properties": {
    "call_outcome": { "type": "string", "enum": ["answered", "partial", "not_on_file",
        "rep_refused", "ivr_dead_end", "hold_timeout", "unreached", "unknown"] },
    "reference_number": { "type": "string" },
    "representative_name": { "type": "string" },
    "claims": { "type": "array", "items": { "...": "one of the item schemas below" } }
  }
}
```

Three properties hold for every schema, and together they are what makes the output safe to act on:

1. **Closed.** `additionalProperties` is `false`, so an extra field is an error rather than a curiosity.
2. **Fully required.** Every property is required, so a missing field is an error rather than a silent absence.
3. **`unknown` always available.** Every field accepts the literal string `unknown`, and every enum includes it. Nothing is ever forced to invent a value to satisfy the schema.

The third one is what makes the first two safe. A closed, fully-required schema with no escape hatch pressures a model into filling fields it does not know.

## Per-claim items

Each item also carries `claim_number` and `evidence_quote`.

### claim_status

| Field | Type |
| --- | --- |
| `claim_status` | enum: paid, denied, pending, in_process, rejected, not_on_file, unknown |
| `paid_amount` | string |
| `allowed_amount` | string |
| `patient_responsibility` | string |
| `check_number` | string |
| `paid_date` | string, `YYYY-MM-DD` when stated |

### denial_reason

| Field | Type |
| --- | --- |
| `carc_code` | string, for example `CO-97` |
| `rarc_code` | string, for example `N130` |
| `denial_reason_text` | string |
| `appealable` | enum: yes, no, unknown |
| `appeal_deadline` | string, `YYYY-MM-DD` when stated |
| `appeal_method` | string |
| `corrected_claim_accepted` | enum: yes, no, unknown |

### prior_auth_status

| Field | Type |
| --- | --- |
| `auth_status` | enum: approved, denied, pending, not_found, unknown |
| `auth_number` | string |
| `effective_date` | string, `YYYY-MM-DD` when stated |
| `expiration_date` | string, `YYYY-MM-DD` when stated |
| `units_approved` | string |
| `missing_information` | string |

### eligibility

| Field | Type |
| --- | --- |
| `coverage_active` | enum: active, inactive, terminated, unknown |
| `plan_name` | string |
| `group_number` | string |
| `deductible_total` | string |
| `deductible_met` | string |
| `copay` | string |
| `coinsurance` | string |
| `out_of_pocket_max` | string |
| `out_of_pocket_met` | string |
| `prior_auth_required` | enum: yes, no, unknown |

## Amounts are strings

A representative says "one forty two sixty". Forcing that into a number invites a wrong number. The string keeps what was said, the quote proves it, and the billing system parses it under a person's eye.

## What counts as a complete answer

Completeness is status-aware, because `unknown` is often the right answer:

| Workflow | Always needed | Also needed when |
| --- | --- | --- |
| `claim_status` | `claim_status` | status is `paid`: `paid_amount`, `paid_date` |
| `denial_reason` | `carc_code`, `denial_reason_text`, `appealable` | appealable is `yes`: `appeal_deadline`, `appeal_method` |
| `prior_auth_status` | `auth_status` | approved: `auth_number`, `effective_date`. pending: `missing_information` |
| `eligibility` | `coverage_active` | active: `plan_name`, `deductible_total`, `copay`, `prior_auth_required` |

A denied claim has no allowed amount and a pending authorization has no authorization number. Reporting those as `unknown` is a complete answer. A claim reported as `paid` with no amount is not.

## Groundedness

`evidence_quote` is the representative's own words for that claim, quoted as spoken. After the call, search for it in the transcript after lowercasing, stripping punctuation, and collapsing whitespace. A quote shorter than six words is refused however well it matches: a single common word like "paid" appears in almost any billing call and grounds nothing.

When a quote cannot be found, reset that claim's core fields to `unknown` and route it to a person. Leave the other claims on the call alone.

## Reference number

`reference_number` is the plan's identifier for the call itself. Without it a later dispute has no record that the conversation happened, so the agent asks for it on every call regardless of outcome. Capture the representative's first name for the same reason.
