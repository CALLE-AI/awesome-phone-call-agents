# Safety — BridgeCalle Active Listener

## Intent and Consent

- Place outbound calls **only with explicit consent** from the senior or an authorized family member/caregiver (`confirm_recipient_opt_in`).
- Do not make unsolicited calls, telemarketing, or cold outreach.
- Mask and redact phone numbers in public logs, previews, and summaries (e.g. `+91 ***** **610` or `+1 *** *** 0000`).

## Non-Clinical Boundaries

BridgeCalle is a **warm conversation companion**, not a licensed healthcare provider or medical service.

- No medical advice, diagnosis, or prescription management.
- No emergency crisis handling — if a user is in danger or crisis, direct them to emergency services immediately.
- Gently redirect medical or health topics back to everyday life, memories, and emotional support.

## Phone Numbers and Data Privacy

- Require valid **E.164** formatted phone numbers (`^\+[1-9]\d{1,14}$`). Do not accept invalid phone numbers or strip characters silently.
- Use standards-reserved fictional numbers (`+15550100000` or `+919876543210`) in samples and documentation.
- Explicitly pass `region` and `locale` (e.g. `IN` / `en-IN` or `US` / `en-US`) to match destination telephony routes.
- Store credentials and API keys exclusively in server environment variables (`CALLE_API_KEY`); never expose API keys in browser client code or commit secrets to repositories.

## Side Effects & Dry-Run Mode

- Live execution (`execute: true` with server `CALLE_API_KEY`) initiates a real phone call via CALL-E's provider network.
- When `execute` is omitted or no `CALLE_API_KEY` is present, the app operates in dry-run preview mode without network calls.
- Active listening 90/10 ratio is a prompt-guided system instruction directive.

## Cancellation

- Calls can be canceled or reviewed in the CALL-E platform dashboard.
