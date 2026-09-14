# Pull request draft

**Title:** `feat(apps): add Senior Phone AI call and follow-up demo`

## Summary

Adds Senior Phone AI, a Next.js reference app for explicitly confirmed CALL-E
workflows for older Australians.

- Prepares one shared, source-backed Australian daily briefing and injects it into
  CALL-E before a call. No recipient profile is required, and topics without
  acceptable citations remain unavailable.
- Places or schedules one reviewed outbound call using E.164 normalization,
  masked confirmation, idempotent dispatch and cancellable pending schedules.
- Shows provider status, summaries, transcript turns and the matching SMS record
  together in the Calls table.
- Collects explicit in-call permission for one recap or public-information
  request, searches after completion, and composes a concise customer-facing SMS
  with a source.
- Supports operator-only SMS previews for local demos and an explicitly enabled
  Australian Twilio adapter with authenticated receipt checks.
- Includes a protected OpenAI Realtime browser harness, server-side web search,
  safety boundaries, encrypted local state and deterministic fake-provider tests.

Preview mode is the default. Tests do not place calls, run live searches or send
SMS.

## Validation

- Full ESLint run passed.
- `tsc --noEmit` passed.
- `node --import tsx --test tests/*.test.ts` passed: 110 tests.
- `python scripts/validate_repository.py` passed.
- Local live acceptance verified the CALL-E call monitor, shared daily knowledge,
  consent-gated post-call restaurant search and per-call SMS preview display.

## Current limitations

- The app supports outbound calls only.
- The current CALL-E integration cannot call the app's OpenAI web-search tool
  during a provider-hosted phone call. New public-information requests are
  searched after call completion and returned through the consented SMS
  follow-up; only the prebuilt daily briefing is available inside the call.
- Daily knowledge can be partial when a topic has no acceptable cited evidence.
- Knowledge-enabled scheduled calls are limited to later on the same Australian
  day so they cannot reuse stale briefing data.
- The operator surface is restricted to loopback and is not a production
  authenticated multi-user console.
- Live Twilio carrier delivery remains separately configurable and was not part
  of the SMS-preview acceptance run.
- CALL-E may publish transcript turns only after a call reaches a terminal state.
- Two-way inbound SMS questions with current web search are planned in SPA-020
  and are not included in this change.

## Checklist

- [x] Repository-facing content is English and follows repository naming rules.
- [x] No credential, real phone number, recording or private transcript is
  committed.
- [x] Calls require explicit operator review and confirmation.
- [x] SMS follow-ups require verified recipient permission and remain bound to
  the called number.
- [x] Phone numbers and provider call IDs are masked in browser responses.
- [x] Scheduling, cancellation, uncertainty, retention and preview behavior are
  documented.
- [x] Default tests use fake or preview providers.
