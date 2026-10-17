# Preference contract

Input: `transcript` plus `call_context.organization`, `.purpose`, and `.task`.
Optional `.campaign` and `.current_preferences` supply context, not inferred intent.
Plain transcript strings represent recipient speech; dialogue uses an array of
`{"speaker": "recipient" | "agent", "text": "..."}` turns. All required strings
are nonempty. Do not request a phone number. Invalid input needs correction before
interpretation, rather than an empty successful result.

## Output

Exactly two top-level fields: `status` and `preferences`.

`status`:
- `no_preference_detected`: empty preferences list.
- `review_required`: at least one proposal needs semantic clarification.
- `preferences_detected`: nonempty list without a review requirement, including
  explicit this-call preferences retained for evidence with `no_update`.

Every proposal contains all of these fields:

| Field | Allowed values / meaning |
| --- | --- |
| `preference_type` | `call_window`, `channel`, `language`, `do_not_call`, `voicemail` |
| `value` | See type-specific rules below; null only for unresolved review proposals |
| `duration` | `one_time`, `time_bounded`, `ongoing`, `unknown` |
| `scope` | `this_call`, `this_task`, `this_campaign`, `organization`, `unknown` |
| `evidence` | Nonempty exact substring of a recipient turn, preserving qualifiers |
| `confidence` | `high`, `medium`, `low`; never a substitute for evidence |
| `requires_human_review` | Boolean; semantic uncertainty only, never execution approval |
| `recommended_action` | `update_preference`, `request_confirmation`, `no_update` |

Optional fields: `time_bound` (verbatim recipient excerpt), `review_reason`,
`suggested_clarification`. The last two are required for reviewed proposals.
No consent fields, execution payloads, phone numbers, or arbitrary additional keys.

- `call_window`: nonempty string describing the requested window; do not schedule it.
- `channel`: `sms`, `email`, `phone`, or another explicitly named channel string.
- `language`: normalize an explicit Chinese-language preference to `zh-CN`, as
  required by this MVP's agreed interchange convention; use `en` for English.
  This code is a storage convention, not evidence of residence, nationality, dialect,
  or legal jurisdiction. For other languages, use a language-only tag unless the
  recipient explicitly requests a locale. Preserve the original words in evidence.
- `do_not_call`: boolean `true` for explicit restriction. Do not infer `false`
  permission from silence, a callback, or a correction of a different scope.
  An unambiguous withdrawal may propose `false` without semantic clarification;
  it does not grant consent. Clearing DNC remains unsupported by the mock adapter.
- `voicemail`: `allowed` or `not_allowed`.

## Duration and review

`one_time` means one occurrence, e.g. a callback tomorrow afternoon.
`time_bounded` means a limited period, e.g. no calls today or contact next week.
`ongoing` means an explicit standing instruction within its scope, not a universal
forever policy. `unknown` means no supported determination can be made.

For `time_bounded` and `one_time` (except `this_call`), include `time_bound` as an
exact excerpt preserving the requested period. A host must not persist it as an
unqualified durable scalar. These relative bounds are descriptive, not executable.

Unknown scope/duration, null values, low confidence, or a missing campaign identity
for a campaign proposal require `requires_human_review: true`,
`recommended_action: request_confirmation`, a reason, and a clarification.
Execution impact alone never requires semantic review. An explicit organization-wide
ongoing DNC has `requires_human_review: false` and `recommended_action: update_preference`.
Do not add a recipient clarification for an already explicit request. The adapter
separately requires operator approval before writing to the mock CRM, including
`global_do_not_call: false -> true`; this does not change the Skill's status or fields.
For the ended call, `scope: this_call` requires `duration: one_time` and `no_update`;
if uncertain, request confirmation instead. When review is needed, it takes precedence
over `no_update`. A mixed result uses `status: review_required` if any item needs review.

Never broaden a value while normalizing it. Each proposal's quote must include
relevant scope/time qualifiers or the correction context. A confidence score cannot
override the quoted words. A syntactically valid quote does not prove semantic support.
