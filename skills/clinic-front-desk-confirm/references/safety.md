# Safety

- Practice / dry-run is the default. Live calls require explicit operator intent and `CALLE_API_KEY`.
- Only dial E.164 numbers the operator provided and is authorized to call.
- Mask phone numbers in logs, UI, and samples (show last four only).
- Use standards-reserved or clearly fictional sample numbers in docs (`+447700900123` style test ranges).
- Do not collect payment details, government IDs, or clinical history.
- Do not give medical, legal, or financial advice on the call.
- Do not auto-retry no-answer or failed live calls.
- Do not write calendars or CRMs from this skill; a human applies the result.
- If the callee says stop calling / wrong number, end immediately and record decline or no-answer.
