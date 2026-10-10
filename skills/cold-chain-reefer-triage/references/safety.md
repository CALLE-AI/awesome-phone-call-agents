# Safety Reference

## Who May Be Called

- **Authorized Contacts Only**: Outbound voice calls are strictly restricted to verified commercial drivers whose telephone numbers are explicitly provided in active TMS dispatch records or telematics manifest feeds.
- **Strict E.164 Formatting**: Every destination telephone number must strictly conform to international E.164 format (e.g. `+13035550147`). Non-E.164 strings are rejected before any API payload is constructed.
- **Emergency Number Exclusion**: National and international emergency numbers (such as 911, 112, 999, 000, 110, 119) and shortcodes are structurally blocked from outbound dialing.

## Transport & Credential Security

- **HTTPS-Only Enforcement**: All API communications with the CALL-E platform must use encrypted HTTPS (`https://`). Non-HTTPS or plain HTTP URLs are rejected immediately with a `ValueError`.
- **Credential Isolation**: Telephony API credentials (`CALLE_API_KEY`) must reside exclusively in secure server environment variables. Secrets are never hardcoded, written to disk, or interpolated into prompts.
- **Header & Token Sanitization**: Error logging layers actively strip and redact authorization tokens and Bearer headers prior to recording error summaries.

## Privacy & Destination Masking

- Destination telephone numbers are automatically masked across all console logs, trace spans, and operational summaries (e.g., formatting `+13035550147` as `+1303***0147`).
- Voice call recordings and raw conversational transcripts must not be exposed in unauthenticated interfaces or forwarded to third-party endpoints.

## Zero-Redial Policy

- The skill enforces a strict **Zero-Redial Policy**: exactly one outbound call attempt is permitted per incident event.
- If a call is dropped, encounters network congestion, rings out unanswered, or returns `busy` / `failed`, the agent does **not** loop or automatically redial the driver.
- Unanswered or incomplete calls are immediately yielded as failure states to prompt human dispatch intervention.

## Human Dispatch Authority (Advisory Scope)

- The voice triage skill operates in an **advisory capacity**: it collects real-time physical evidence from the driver and records their agreed preference.
- The skill does **not** possess authority to autonomously reroute vehicles, book cold-storage docks, or dispatch roadside service without human fleet manager validation.
- If the driver reports an active vehicle collision, fire, or roadside emergency, the voice agent directs the driver to dial 911 and terminates fact-finding immediately.
