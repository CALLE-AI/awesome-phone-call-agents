# Qualification Schema Contract

This reference defines the BANT-style result schema for the lead-qualification-call. The CALL-E `result_schema` and the downstream CRM projection both depend on these contracts.

## Result fields

| Field | Type | Allowed values | Description |
|---|---|---|---|
| `needs` | string | free text, empty if not disclosed | Short description of the stated need, in the lead's own words where possible |
| `budget_range` | string | `under_1k`, `1k_5k`, `5k_20k`, `20k_plus`, `not_disclosed` | Stated budget range; `not_disclosed` only if the lead explicitly declined |
| `timeline` | string | `immediate`, `1_3_months`, `3_6_months`, `6_months_plus`, `unknown` | Stated timeline to act |
| `is_decision_maker` | boolean | `true` / `false` | Whether the lead is the final decision maker; `false` includes "I need to check with someone else" |
| `interest_level` | string | `high`, `medium`, `low` | Expressed interest; must be grounded in the transcript, not guessed |
| `callback_requested` | boolean | `true` / `false` | Whether the lead requested a follow-up call, and whether a time was proposed |
| `disposition` | string | see below | Fail-closed classification of what happened on the call |

## Dispositions

| Disposition | Meaning | Next step |
|---|---|---|
| `qualified` | Lead disclosed meaningful BANT fields and the transcript supports high or medium interest with a clear need | Route to human sales queue for review before any CRM write |
| `needs_human` | Answer quality is unclear, the lead asked a complex question, or a middle gate blocked confidence | Route to human for direct conversation |
| `not_interested` | Lead explicitly declined or expressed no intent to proceed | Suppress; log for future outreach cycle only if explicitly opted in |
| `blocked_compliance` | Privacy, DNC, identity mismatch, or policy gate blocked the call | Silent suppress; human compliance review required |
| `voicemail` | Voicemail was detected | Human decides whether to retry or leave a longer message |
| `no_answer` | No human picked up | Human decides whether to retry at a different time |
| `wrong_number` | Person on the line is not the lead | Log mismatch; no further calls to that number without re-authorization |

## Fail-closed rules

1. Do not infer `qualified` from a short call, a silence, or a single vague sentence.
2. Low confidence answers from the model or the transcript always route to `needs_human`.
3. Any schema field that is technically present but not substantiated by transcript evidence is marked `needs_human` in the disposition, even if `interest_level` appears high.
4. The `interest_level` field must never be `high` when the transcript shows no clear positive signal.

## Idempotency key

Format: `lead_qualification:{lead_id}:{campaign_id}`. A retry for the same lead and campaign reuses the same key. A changed phone, lead_id, or campaign_id requires a new key and is treated as a different intent.