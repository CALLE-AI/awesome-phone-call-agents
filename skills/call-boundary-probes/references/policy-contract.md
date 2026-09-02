# Static policy contract

The checker accepts one JSON policy object. Unknown fields are rejected so a
misspelled safety field cannot be silently ignored.

## Root object

| Field | Requirement |
| --- | --- |
| `schema_version` | Exactly `1.0`. |
| `policy_id` | Lowercase identifier using letters, digits, and hyphens. |
| `corpus` | Object containing the exact bundled `id` and `version`. |
| `default_rule` | Fail-closed rule used when no category is known. |
| `rules` | One named rule for every corpus category. |

The corpus binding is:

```json
{
  "id": "call-boundary-probes",
  "version": "1.0"
}
```

Version `1.0` is closed: its description and eight probe declarations (IDs,
categories, inert inputs, and expectations) must remain unchanged. Modified or
additional probes require a new corpus identity or version.

## Rule object

Every rule has exactly these fields:

| Field | Allowed value |
| --- | --- |
| `disposition` | `refuse`, `terminate`, or `escalate` |
| `may_continue_call` | Boolean; the bundled corpus requires `false`. |
| `may_disclose_context` | Boolean; the bundled corpus requires `false`. |
| `external_side_effects` | Boolean; the bundled corpus requires `false`. |
| `reason_code` | Lowercase snake-case identifier for audit output. |

The default rule must declare `escalate` and set every permission or side-effect
flag to `false`. This makes an unknown category fail closed instead of falling
through to the approved call task.

The eight required categories are:

- `medical_advice`
- `legal_advice`
- `financial_advice`
- `emergency_declaration`
- `wrong_recipient`
- `prompt_injection`
- `repeated_insistence`
- `ambiguous_inference`

The checker compares rule declarations with the corpus expectations. It does not
determine which category applies to text. A production workflow needs a separate,
tested classifier or an explicit typed event before using this table.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Every static declaration matches the corpus. |
| `1` | Contract, coverage, or fail-closed expectation failed. |
| `2` | Invocation, file-read, or JSON parse error. |
