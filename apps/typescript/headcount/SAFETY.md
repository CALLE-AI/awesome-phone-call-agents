# Safety — headcount

How maintainers decide whether to merge.

Headcount identifies as an automated AI assistant from the named agency on the
first turn. It is a safety and needs check, **not** an emergency service.
Default mode is fixture replay. Live calling requires `CALLE_LIVE=1`, a real
API key, and an explicit non-555 destination.

Region, locale, and timezone are stored per roster row and are never inferred
from the phone number. Seed data and screenshots use reserved fictional NANP
`555` numbers, displayed masked (`+1 555 ••• ••01`).

The header always shows remaining budget against a project cap of 20. The kill
switch is on every screen; it blocks new dials and cancels in-progress fixture
attempts (`cancelled` → Unaccounted).

## Disclosure

- Compiled task text says this is an automated AI assistant from the named
  agency, a safety and needs check, not an emergency service.
- Voicemail leaves a short callback and asks no questions.

## Opt-out and retries

- Roster is opt-in. Wave 2 only retries `RETRYABLE` dispositions.
- Wrong-person and hostile do not retry.
- Kill mid-wave cancels remaining queued attempts.

## When the model is wrong

- `task_completed: true` is a claim to audit, not a fact.
- Unsupported fields render struck-through and never count as a completed
  assessment.
- Fail-closed → a human dispatch card, never auto-resolved:
  `safety_status == medical_emergency`, `evacuation == trapped`,
  `needs_human == yes`, low completion confidence on a critical field, or any
  unsupported critical field.

## Out of scope

- Not an emergency service. It never gives medical, evacuation, or safety
  advice, and never promises a response time.
- English-only task text.
- No hidden recurring schedules.
