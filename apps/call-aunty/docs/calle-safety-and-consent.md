# CALL-E safety and consent

## Non-negotiables

1. No automatic outbound calls from startup, sync, or passive renders.
2. Explicit CHW prepare → review side effects → confirm.
3. Consent required (`callConsentGranted`) for live eligibility.
4. Urgent `urgent_in_person_care` blocks conversational delay; human escalation stays primary.
5. Agent tasks must not diagnose, prescribe, or replace urgent in-person care.
6. API keys never leave the server.
7. Logs and fixtures must not include real phone numbers, transcripts, names, or clinical narratives.

## Consent model

- Default deny for live calling.
- Demo UI uses an explicit prepare action that records consent for that workflow.
- Recipient region and call language are shown before confirm.

## Privacy

- Public API responses mask E.164 (`+15***23`).
- Structured results are enum/boolean fields only.
- Follow-up notes stay short and logistical.

## Dry-run

Without `CALLE_API_KEY` + `CALLE_LIVE_CALLS=true`, all confirms use dry-run. UI labels dry-run clearly.
