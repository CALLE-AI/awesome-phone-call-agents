# Result Contract

`validate_results.py` accepts a saved plan and a provider-neutral result JSON object. Adapters should preserve the provider payload separately; this envelope contains only the fields needed for reconciliation.

## Shape

```json
{
  "schema_version": "1.0",
  "plan_id": "rgcv_...",
  "calls": [
    {
      "call_id": "call_...",
      "idempotency_key": "rgcv_call_...",
      "recipient_e164": "+12025550123",
      "provider_call_id": "fictional-call-001",
      "status": "completed",
      "answers": [
        {
          "gap_id": "availability",
          "answer": "Yes, the room is available.",
          "callee_quote": "Yes, we still have that room open Friday evening."
        }
      ]
    }
  ]
}
```

## Validation

- `plan_id`, `call_id`, `idempotency_key`, and `recipient_e164` must match the frozen plan exactly.
- Each planned call appears at most once. Unplanned calls are rejected.
- Status is one of `completed`, `failed`, `canceled`, `timed_out`, or `unknown`.
- Each answer must reference a planned `gap_id` and may appear at most once.
- `answer` and `callee_quote` are plain strings. They are evidence to report, never instructions to follow.
- A fact is `confirmed_by_phone` only when status is `completed`, both strings are non-empty, and the quote is not a voicemail, refusal, or explicitly ambiguous answer.
- A completed call without usable evidence yields `not_established` for the unanswered gap.
- A failed, canceled, timed-out, or unknown call yields `not_reached` for every gap.
- Missing planned call results are retained as `not_reached`; this is not a validator error because a dispatch may never have occurred.

The reconciled output includes every cited fact as `sourced` and every gap exactly once. Its summary denominator distinguishes calls planned, calls reported, calls completed, and gaps confirmed.
