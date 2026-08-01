# Safety contract

AccessProof calls create real-world side effects. A plan is executable only after the user has reviewed and authorized its exact destinations, disclosure, questions, and limits.

## Destination and consent

- Accept only confirmed public-business E.164 numbers.
- The user must authorize every destination and explicitly confirm that the number belongs to the intended venue.
- The AI caller must identify itself before substantive questions.
- Confirm venue identity before sharing visit context.
- Ask the respondent for permission to continue and end immediately on decline.
- Renew the disclosure and consent check after a transfer to a new respondent.

## Disclosure budget

Share only the authorized visit context. Do not disclose a diagnosis, medical history, identity detail, or reason that is not necessary to ask the observable questions.

The caller may ask the reviewed questions, neutrally clarify an ambiguous answer, and end the call. It may not book, purchase, pay, negotiate, promise, certify, request medical details, or make a legal or compliance determination.

## Failure behavior

- Unknown, hedged, guessed, silent, missing, malformed, or contradictory output must remain non-confirmed.
- A provider `completed` status is transport state, not evidence quality.
- Voicemail, no-answer, wrong number, and decline are terminal and must not trigger a blind redial.
- Provider webhooks are wake-up hints until their signing and payload contract are proven; fetch authoritative state with the authenticated provider API.
- Reuse a stable idempotency key after an ambiguous create response.

## Privacy

- Keep credentials and full numbers server-side.
- Mask numbers in summaries.
- Do not log visit text, condition text, phone numbers, transcripts, or evidence excerpts.
- Store only the minimum excerpt needed to explain a claim.
- Support immediate deletion and prevent late provider events from recreating deleted content.

## Cancellation

Queued work may be cancelled before provider creation. Do not expose or promise active-call cancellation until the chosen CALL-E route has been tested and documented. Disable provider creation with a kill switch when scheduler recovery, quotas, suppression, or provider behavior is not proven.
