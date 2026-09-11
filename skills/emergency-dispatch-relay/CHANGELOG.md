# Changelog

## 0.2.0 — 2026-09-11
- Fix: `eta_minutes` was enum-locked to `["unknown"]`, making any numeric ETA
  impossible to return. Now free-form string with digits-or-"unknown" guidance.
- Fix: request payload aligned to the actual SDK `CreateCallInput` — single
  `recipient` object (`phone`, `region`, `locale`, `name`) instead of a phone
  list.
- Add: request `policy` block — `maxAttempts: 1`, `voicemail: do_not_leave`,
  `onNotReady: error`. No automatic redial; voicemail never counts as reaching
  a unit.
- Add: stable idempotency key derived from the case id — replaying a relay
  cannot double-call the unit.
- Add: real mode now submits with `calls.create` and polls `calls.get` instead
  of blocking on `createAndWait`; honest timeout note when polling exceeds
  200s without redialing.
- Docs: goal-template now documents the policy block and the eta fix rationale.

## 0.1.0 — 2026-09-11
- Initial skill: preview-first CLI, tri-state result schema, safety and
  examples references.
