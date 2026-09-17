---
name: bridgecalle-active-listener
description: Prompt-guided active-listening phone check-in companion skill for seniors that uses CALL-E outbound phone calls to provide gentle verbal nods, extract nostalgic memories, and export family summaries.
license: MIT
---

# BridgeCalle Active Listener

Use this skill when an **elderly person, family member, or caregiver** (with explicit recipient consent) wants an empathetic, active-listening phone check-in call to reduce loneliness and foster emotional connection between visits.

BridgeCalle flips the traditional voice-agent paradigm: instead of an AI that talks at the user, it configures CALL-E task instructions for **prompt-guided active listening**, encouraging the AI agent to speak sparingly with gentle verbal nods (*"Mmhmm"*, *"I hear you"*, *"How lovely"*). Note: Active-listening speaking ratios and turn behavior are prompt-guided system instruction directives rather than hard platform enforcement, subject to provider model adherence.

## When to use

- Outbound phone check-ins for elderly loved ones or seniors living alone.
- Capturing nostalgic memories, daily reflections, and emotional state in a structured post-call summary.
- Exporting warm call summaries to family members via SMS or WhatsApp.

## When not to use

- Emergency medical response, crisis intervention, or suicide prevention hotline replacement.
- Unsolicited cold outreach, marketing, or telemarketing.
- Clinical diagnosis or medical advice.

## Workflow

1. Read `references/safety.md` and confirm **explicit recipient consent** and **authorized E.164 phone number**.
2. Require explicit live execution flags (`--execute` and `--confirm-recipient-opt-in`); default to dry-run preview mode when credentials or execution confirmation are omitted.
3. Pass valid **E.164** phone number, explicit CALL-E `region` (e.g., `IN` or `US`), and `locale` (e.g., `en-IN` or `en-US`).
4. Execute the call task prompt:
   ```text
   Call <E164_PHONE> in English. Ask gently if they drank water and ate food today. Then listen quietly with short nods like 'Mmhmm' and 'How lovely'.
   ```
5. Capture structured call summary, start time, duration, and key memory points.
6. Display masked phone numbers in user-facing summaries.

## Persona and Rules

- **Initial Greeting:** Short 1-sentence gentle inquiry (e.g. water and meal check-in).
- **Prompt-Guided Active Listening:** System instructions instruct the AI agent to listen quietly, offering 1-2 word verbal nods (*"Mmhmm"*, *"I hear you"*, *"How lovely"*).
- **Patient Silence & Model Adherence:** Configures a patient silence threshold before speaking. Turn length and silence behavior depend on LLM adherence to prompt instructions.

## Output

After a call attempt, expect structured output fields:

- `call_number` — sequential call attempt index
- `start_time` — call initiation timestamp
- `duration` — call duration (e.g., `2 mins 10 secs` or `0s` if unplaced)
- `status` — `COMPLETED` | `NOT CONNECTED` | `DISPATCHED`
- `points` — array of key summary points (XSS-escaped and masked)
