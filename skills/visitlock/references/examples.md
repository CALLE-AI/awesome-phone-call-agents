# Examples

All participant names and phones below are fictional. Numbers use the `+15550100xxx` reserved-style block.

## Safe

- A study coordinator runs `python -m visitlock demo` with fixture results to preview confirmation_rate HUD without placing calls.
- Confirming a CSV of consented research visit slots for Site A, recording `yes` / `no` / `reschedule` / `no_answer` into the ledger.
- Re-running the same CSV after a partial batch: completed ledger keys are skipped (no double-dial).
- Reviewing a `reschedule` result and preferred_slot with a human before any calendar change.

## Unsafe

- Calling scraped patient or public phone lists without study consent.
- Treating voicemail or `no_answer` as a confirmed visit.
- Giving clinical advice, lab results, or emergency guidance on the call.
- Auto-writing EHR or calendar changes from structured RSVP without a human.
- Putting `CALLE_API_KEY` in the CSV, HUD, or committed config.
- Using VisitLock for single consumer appointment confirm instead of `appointment-confirm`.
