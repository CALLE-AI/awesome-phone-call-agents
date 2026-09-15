# Safety

- Live mode requires `CONVERSACT_LIVE_CALLS=true`, an explicit `--confirm-place-real-call`, an authorized recipient, and strict E.164.
- Consent is bound to one session, one recipient, and `conversational_checkout`; a consumed consent cannot silently start another logical call.
- Output masks telephone numbers. API keys are read only from `CALLE_API_KEY`, never command-line arguments or fixtures.
- Before building the SDK client, actual credentials are restricted to the approved HTTPS provider. Loopback fake servers accept only the literal dummy credential `conversact-fake-key`, never a real API key.
- Stable idempotency is `conversact:<session>:call:v1`. This supports at most one intended logical call effect for ordinary retry paths; it is not a claim of distributed exactly-once delivery.
- A timeout, connection loss, 409, 429, or 5xx create result is ambiguous. The app does not redial automatically or create downstream commerce/payment effects.
- A terminal call is not an order. Missing or contradictory evidence, unknown confirmation, decline, and opt-out do not create a quote or checkout handoff.
- CALL-E cannot establish price, inventory, total, payment, or receipt state. The local commerce adapter recomputes the quote from its own catalog.
- No transcript is persisted by default. The demo has no recurring jobs.
- The task is limited to fictional commerce and declines medical, legal, financial, emergency, and personal-safety advice.
