# MVP verification and residual risks

The default verification path is offline and does not place calls, send SMS, or require production credentials. Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, and the repository-level `python scripts/validate_repository.py` check.

The automated suite covers exact action authorization, changed destinations, E.164 validation, formatted and nested phone redaction, consent enforcement, family RLS, same-origin dashboard mutations, duplicate and out-of-order SMS callbacks, scheduler concurrency, cancellation races, bounded retries, uncertain dispatch after restart, no-answer/voicemail ambiguity, malformed CALL-E payloads, tool failures, disconnected realtime latency state, untrusted HTML escaping, and post-call finalization deduplication. Safe workflow events retain only a UUID correlation ID, component, outcome, bounded latency, masked destination, bounded provider code, and timestamp.

The following checks remain manual or environment-dependent:

- Apply and verify every migration against the chosen hosted Supabase project.
- Confirm browser microphone permissions, actual Realtime first-audio latency, and arbitrary same-session web searches.
- Confirm configured scheduler invocation and restart behavior on the chosen host.
- Confirm CALL-E account limits and coarse terminal outcomes with an explicitly approved test recipient.
- Complete the live Twilio/SIP inbound telephone and SMS proof in SPA-004. Public CALL-E responses do not currently provide stable machine-readable no-answer and voicemail categories.

Provider outages can leave a dispatch in `unknown` or a pre-dispatch reservation in `queued`. These states intentionally require operator reconciliation instead of an automatic retry that could duplicate a real phone call or message.
