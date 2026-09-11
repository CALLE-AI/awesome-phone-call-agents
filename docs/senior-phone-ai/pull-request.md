# Pull request draft

**Title:** `feat(apps): add Senior Phone AI`

## Summary

Adds a Next.js reference app for consent-first senior phone workflows: browser Realtime with current web search, confirmation-gated SMS and reminders, explicitly approved CALL-E outbound calls, durable Supabase state, grounded post-call summaries, and a family/carer dashboard. Preview and fake adapters keep tests free of live calls and SMS; Twilio/SIP remains the final separately verified gate.

## Type

- [x] New runnable app
- [x] Scheduler recipe
- [x] Safety or documentation update

## Validation

- `pnpm test`, `pnpm lint`, `pnpm typecheck`, and `pnpm build`
- production startup and signed-out access probes
- `python scripts/validate_repository.py`

## Checklist

- [x] Repository content is English and naming follows the convention.
- [x] No secret, real number, recording, or private transcript is intentionally included.
- [x] Side effects, consent, cancellation, uncertainty, and retention are documented.
- [x] Default tests use preview/fake providers.
- [ ] Add redacted live browser-search evidence after an explicitly approved demo.
- [ ] Complete Twilio/SIP telephone proof in SPA-004.
