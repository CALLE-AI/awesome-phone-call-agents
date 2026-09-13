# Safety — BridgeCalle Active Listener

## Intent and Consent

- Place outbound calls **only with explicit consent** from the senior or an authorized family member/caregiver.
- Do not make unsolicited calls, telemarketing, or cold outreach.
- Mask and redact phone numbers in public logs and previews.

## Non-Clinical Boundaries

BridgeCalle is a **warm conversation companion**, not a licensed healthcare provider or medical service.

- No medical advice, diagnosis, or prescription management.
- No emergency crisis handling — if a user is in danger or crisis, direct them to emergency services immediately.
- Gently redirect medical or health topics back to everyday life, memories, and emotional support.

## Phone Numbers and Data Privacy

- Require valid **E.164** formatted phone numbers (`+91...`, `+1...`).
- Explicitly pass `region` and `locale` (e.g. `IN` / `en-IN` or `US` / `en-US`) to match destination telephony routes.
- Store credentials and API keys in environment variables (`CALLE_API_KEY`); never commit secrets to repositories.

## Side Effects & Cancellation

- Placing a call initiates a real phone call via CALL-E's provider network.
- Calls can be canceled or reviewed in the CALL-E platform dashboard.
