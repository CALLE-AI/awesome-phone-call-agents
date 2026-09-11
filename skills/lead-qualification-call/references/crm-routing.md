# CRM Routing

Use this reference when routing a completed lead-qualification result to a sales queue or CRM integration. This skill does **not** write to a CRM. It produces a disposition and a structured result that a human or a host-side workflow consumes.

## Disposition-to-action table

| Disposition | Immediate action | Notes |
|---|---|---|
| `qualified` | Add to human-reviewed sales queue. Do not auto-assign a rep or auto-create a meeting. | Attach the masked phone, the structured result, and the transcript. A human reviews before any outreach. |
| `needs_human` | Add to human-review queue with a short note explaining why qualification failed or was unclear. | Do not retry automatically. |
| `not_interested` | Suppress from active follow-up. Log for future only if a future opt-in exists. | Never call again without new explicit consent. |
| `blocked_compliance` | Send to compliance review. No active sales follow-up. | Record the reason without logging the full phone number in plain text. |
| `voicemail` | Human decides whether to retry or to leave a longer message. | No auto-redial without explicit scheduler approval. |
| `no_answer` | Human decides whether to retry at a different time or move to email. | Respect quiet hours in the lead's timezone. |
| `wrong_number` | Log the mismatch. Stop outreach to that number. | Requires new authorization before any future call to that lead. |

## CRM fields to carry

When a host-side workflow writes a CRM record, the following masked fields are safe to store:

- `lead_id` (local, not the phone)
- `campaign_id`
- `masked_phone` (never the raw E.164)
- `disposition`
- `interest_level`
- `budget_range`
- `timeline`
- `is_decision_maker`
- `callback_requested`
- `next_best_time` (only if the lead stated one; otherwise empty)
- `qualification_summary` (free text, no PII beyond what the lead volunteered)

The raw transcript, raw E.164, and full voice recording stay in the call platform or a restricted-access store and are never written to a broad CRM field.

## Consent boundary

Every CRM write or follow-up action is a durable side effect. A human must review and approve the action before any CRM object is created or updated. The skill only produces a result.