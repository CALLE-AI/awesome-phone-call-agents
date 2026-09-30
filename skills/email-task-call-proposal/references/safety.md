# Safety

- Require explicit user approval of the proposed channel, recipient, phone
  number, and bounded goal before any live call.
- Accept E.164 phone numbers only. Mask phone numbers in previews, logs, and
  recordings or screen shares.
- Never commit `CALLE_API_KEY` or send credentials outside the authenticated
  CALL-E origin.
- Make calls one-shot. Do not create hidden retries or recurring schedules.
- Use the proposal id as an idempotency key. If the outcome is ambiguous,
  pause for human reconciliation instead of redialing.
- Treat silence, voicemail, low confidence, and schema drift as
  `needs_human`, never as confirmation.
- Disclose that the caller is AI and end the call when the wrong person
  answers.
- Keep medical, legal, financial, emergency, collections, political, and
  unsolicited marketing work out of scope.
- Do not update a calendar or send a follow-up merely because the call
  returned a requested time. Create a separate proposal for that mutation.
- Before approval, the host must provide a cancellation path. After CALL-E
  accepts a call, the host must report honestly if the provider cannot recall
  it.
