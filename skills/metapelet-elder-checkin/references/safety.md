# Safety — MetaPelet elder check-in calls

## Intent and consent

- Place **one outbound call** only when the recipient (or their authorized caregiver) has **explicitly agreed** to this check-in.
- Do not cold-call, market, or survey strangers.
- Default runnable app mode is **preview** (no CALL-E network call).

## Non-clinical boundaries

MetaPelet is a **warm conversation companion**, not a clinician.

- No medical advice, diagnoses, or medication reminders.
- No emergency handling — if someone is in crisis, they must contact local emergency services or a human caregiver.
- Redirect health topics gently toward emotions, memories, and everyday life.

## Phone numbers and data

- Use **E.164** format for live runs; the app rejects non-E.164 input.
- Set explicit CALL-E **region** and **locale** in the request — do not infer routing from the number prefix.
- Mask phone numbers in logs, previews, and demo materials.
- Do not commit API keys, live request files, or call result JSON with transcripts to git.

## Side effects

- Live `--execute` creates a **real phone call** and consumes CALL-E credits.
- One recipient per run; no hidden recurring schedules in this minimal submission.

## Cancellation

- Before execution: omit `--execute` and `--confirm-recipient-opt-in`.
- After the provider accepts a task, use CALL-E dashboard controls if cancel is available.

## Platform coverage

Confirm outbound regions and locales against CALL-E’s [supported regions and languages](https://github.com/CALLE-AI/call-e-integrations#-supported-regions-and-languages) before live runs.

## Source persona

Conversation rules are adapted from the MetaPelet product prompt (`persona.en.txt` in this skill). This folder is an isolated community contribution snapshot.
