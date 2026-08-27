---
name: metapelet-elder-checkin
description: Place one consent-based outbound CALL-E phone check-in for an older adult using the MetaPelet warm-companion persona (non-medical emotional support), then return structured mood, topics, and repeat-call interest for a family member or coordinator.
license: MIT
---

# MetaPelet Elder Check-in

Use this skill when a **caregiver or family member** (with recipient consent) wants **one friendly phone call** to reduce loneliness between human visits — not a medical reminder and not a replacement for human care.

MetaPelet is an existing voice companion product; this skill packages its **conversation rules** for CALL-E outbound calls and a **structured post-call summary**.

## When to use

- One outbound **wellbeing check-in** to a phone the elder already uses (landline or mobile).
- Conversation in **Russian, Hebrew, or English** (set in the request).
- Return **structured results**: mood, topics discussed, whether they want another call soon.

## When not to use

- Medical reminders, triage, emergency response, or mental-health treatment.
- Unsolicited outreach or lead generation.
- Recurring schedules without a separate scheduler wrapper and explicit consent.

## Workflow

1. Read `references/safety.md` and confirm **recipient consent**.
2. Fill a request JSON with **E.164** `phone`, explicit CALL-E `region` and `locale` (see `apps/python/metapelet-checkin/example_request.json`).
3. **Preview** (no call): run the Python app without `--execute`.
4. **Live call**: set `CALLE_API_KEY`, pass `--execute --confirm-recipient-opt-in`.
5. Share the redacted structured result with the authorized caregiver only.

## Persona and profile

- Core persona: `references/persona.en.txt` (MetaPelet companion snapshot, English repository text).
- Optional demo profile shape: `references/profile-demo.en.txt`.
- Structured output schema: `references/result-schema.json`.

## Runnable app

The reference runner lives at `apps/python/metapelet-checkin/` (relative to this submission repository root). It builds the CALL-E task text from the persona files and calls the CALL-E Python SDK when explicitly executed.

## Output

After a completed call, expect JSON fields:

- `mood` — short mood summary
- `topics` — array of main topics
- `wants_repeat_call` — `yes` | `no` | `unknown`

Mask phone numbers in any user-facing summary.
