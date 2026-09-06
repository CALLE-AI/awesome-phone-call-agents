# Safety

- Explicit research-visit consent language in the CALL-E task; call only numbers the coordinator authorized.
- E.164 phones. Mask numbers in logs, HUD summaries, and demos.
- Never commit `CALLE_API_KEY`. Fixture/dry-run is the default when the key is unset.
- Idempotent dial ledger keyed by `participant_id::visit_datetime` — no double-dial on re-runs; no hidden recurring schedules.
- Fail closed: silence, voicemail, schema drift, and unknown outcomes stay `no_answer` / `unknown` for human review.
- Disclose AI use on the call. Wrong-person ends the call.
- Medical boundary: confirmation logistics only — not clinical advice, diagnosis, treatment, or emergency care.
- Do not treat VisitLock as single consumer appointment confirm (use `appointment-confirm` for that).
