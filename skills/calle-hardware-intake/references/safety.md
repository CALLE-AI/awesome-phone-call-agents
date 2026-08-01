# Safety Reference

Phone calls are real-world side effects. `calle-hardware-intake` must preserve
explicit user control over dialing and strict boundaries at runtime.

## Explicit Intent

Place a call only when the user explicitly asks to make a call. Planning a call
(`calle call plan` / `--dry-plan`) is safe and never dials. Executing a call
(`calle call run`) dials a real phone number and spends one CALL-E credit —
require an explicit go-ahead first.

The `POST /api/calls` endpoint and `scripts/test_call.py` (without `--dry-plan`)
are live-dial paths. `/api/intake` and `/health` never place calls.

## Phone Numbers

Use E.164 numbers only (e.g. `+15551234567`). Do not guess country codes or
reformat ambiguous numbers — ask the user.

Mask phone numbers in any user-facing summary or log. A common mask shows the
first two characters and last four digits, e.g. `+91******0746`. Full numbers
may appear only where execution requires them.

Documentation examples must use reserved fictional numbers, such as
`+15550101234`.

## Credentials

Never expose:

- API keys
- OAuth tokens (CALL-E uses OAuth via `calle auth login`)
- Gemini API keys
- confirmation tokens
- transcript or summary data that reveals private phone numbers

The Gemini key lives in `.env`, which is gitignored. Never commit it. Do not
ask users to paste credentials into chat or logs.

## Consent

Only call numbers the user explicitly provided and intends to be called. For
third-party numbers, require the user to state that the recipient consents.

## Recurring / Duplicate Jobs

This app places one-off calls only; it creates no recurring schedules. If a
recurring or batched variant is added later, it must list existing jobs before
creating duplicates and expose a clear cancellation path.

## Boundaries

CALL-E governs live conversation behavior. Keep goals to legitimate business
calls (appointments, intake, follow-ups). Do not use this skill for medical,
legal, financial, or emergency content, or to attempt to bypass anyone's
voicemail or do-not-call preferences. A no-answer is a normal outcome; the goal
may allow a short voicemail but must not harass.

## Rollback / Cancellation

A planned call can be abandoned simply by not calling `run_call`. A running
call cannot be unsent; the cost is one credit. If a plan needs clarification,
`ready_to_run` is `false` and no dial happens until details are provided.
