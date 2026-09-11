# Safety

This workflow places a real outbound phone call to a consenting responder after an explicit urgent-help trigger. It is an additional escalation channel, not an emergency service.

## Required safeguards

- Require explicit user intent or an explicitly configured urgent-help trigger before placing a call.
- Call only the configured responder. Never call the vulnerable subject as part of this skill.
- Require an E.164 responder phone number; never infer or repair a country code silently.
- Confirm the responder's identity before naming the subject or explaining why the call was placed.
- If identity is wrong, uncertain, or evasive, disclose nothing and end the call.
- Voicemail must not name the subject or reveal the reason for the call. Direct the recipient to the authenticated app instead.
- Do not include diagnoses, symptoms, medications, health history, or speculation about why the trigger occurred.
- Do not expose credentials, raw provider payloads, or full phone numbers in logs or summaries.
- Use a per-subject cooldown plus an idempotency key so retries or repeated button presses do not create duplicate calls.
- Treat voicemail and no-answer as unacknowledged outcomes; do not report them as successful human handoff.
- Keep an independent route to emergency help. CALL-E may be delayed, silenced, unanswered, or unavailable.

## Side effect and cancellation

A live execution creates one real outbound call for each trigger that survives the cooldown. There is no recurring provider job to cancel. Once a call connects, it cannot be recalled; cancellation therefore happens before call creation by suppressing or rejecting the trigger.

## No-call verification

Use `../scripts/fake-calle-api.mjs` to exercise acknowledged, declined, voicemail, no-answer, and wrong-recipient outcomes without ringing a real phone.
