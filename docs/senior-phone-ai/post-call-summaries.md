# Post-call summaries and follow-up

Senior Phone AI finalizes a call only after CALL-E reports a terminal outcome. The summary contains the coarse call outcome, the provider summary when one is available, and saved actions labeled as completed, pending, or failed. If the call ended without reliable content, the record says so instead of inferring what happened. Phone numbers are masked before content is stored.

Summary persistence requires both the senior's `store_summaries` preference and active summary-sharing consent. Authorized family members can read the result through row-level security. Clearing the retained call summary also deletes its post-call finalization record.

SMS follow-up is a separate side effect. It requires explicit opt-in, a strict E.164 recipient, the exact confirmed message, and the existing SMS authorization service. Before provider dispatch, the database atomically changes `not_requested` to `queued`. This reservation prevents repeated or concurrent call-end events from sending duplicates. Provider exceptions are recorded as `unknown`; they are not reported as successful and are not retried automatically.

The current implementation supplies the tested finalization and persistence services for the dashboard work in SPA-013. Live Twilio delivery remains disabled until the final telephone gate in SPA-004.
