# Safety Notes for Outbound Lead Calls

Non-exhaustive operational safety notes for teams running the
`lead-qualification-call` skill. Local telemarketing law is jurisdiction-specific;
have counsel review your program. These notes do not constitute legal advice.

## Consent and authorization

- Call only numbers the lead gave you (signup, form, published business contact)
  with a documented opt-in. Keep `authorized_contact_reason` specific: where the
  consent happened and when.
- Do not call enriched, scraped, purchased, or "likely" numbers. If consent is not
  documented, do not place the call.
- Check the lead against your internal opt-out list and any applicable
  do-not-call registry before every call. This skill does not do that check for you.

## Disclosures on the call

- The caller must disclose it is an AI assistant and who it is calling for,
  before the first question.
- If the workflow records or transcribes, disclose that too, and what the
  transcript is used for.
- If the lead asks to stop, do not call back, or sounds confused, end the call
  and mark `needs_human_review` with the request recorded in `notes`.

## Call hygiene

- One call per request. Retries, second numbers, and "just one more try"
  are out of scope and should be visible host-side decisions, not skill behavior.
- Respect the lead's timezone: schedule during local business hours host-side.
- Voicemail only when `voicemail_allowed` is true, using the approved message.

## Data hygiene

- Keep lead personal data out of this repository. The sample request is fictional.
- Store transcripts and results in the team's own systems with access control.
- Honor deletion and opt-out requests in those systems before the next campaign.
