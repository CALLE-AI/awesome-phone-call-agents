# Changelog

## Maintainer clarification - 2026-09-11
- Mask phone-shaped preview/result output without altering the private call request.
- Omit raw provider transcripts and error details; stop on ambiguous SDK errors.
- Label results experimental/advisory and document prompt, validation, and provider
  deduplication limits. Add a runnable reserved no-call preview fixture.

## 0.2.0 — 2026-09-11
- Fix: `eta_minutes` was enum-locked to `["unknown"]`, making any numeric ETA
  impossible to return. Now free-form string with digits-or-"unknown" guidance.
- Fix: request payload aligned to the actual SDK `CreateCallInput` — single
  `recipient` object (`phone`, `region`, `locale`, `name`) instead of a phone
  list.
- Add: request `policy` block — `maxAttempts: 1`, `voicemail: do_not_leave`,
  `onNotReady: error`. No automatic redial; voicemail never counts as reaching
  a unit.
- Add: stable idempotency key derived from the case id, requesting provider
  deduplication subject to its retention and enforcement.
- Add: real mode now submits with `calls.create` and polls `calls.get` instead
  of blocking on `createAndWait`; honest timeout note when polling exceeds
  200s without redialing.
- Docs: goal-template now documents the policy block and the eta fix rationale.

## 0.1.0 — 2026-09-11
- Initial skill: preview-first CLI, tri-state result schema, safety and
  examples references.
