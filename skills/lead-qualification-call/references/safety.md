# Safety

- Consent is a hard gate: the lead record must carry an explicit outreach basis or callback request, and `consent` must be `true`. No cold outreach, no scraped lists, no SPAM.
- E.164 only. Mask phone numbers in every log, summary, and video. Example masked form: `+15550101234` -> `+1555010****`.
- Never commit `CALLE_API_KEY` or any credential. Live calls only go to `https://api.heycall-e.com`.
- One disclosed call per lead. No hidden retries, no recurring schedules, no provider-side campaigns.
- The agent discloses it is AI at the start. Wrong-person ends the call.
- No selling, closing, negotiating, or payment collection on the call.
- Fail closed: silence, voicemail, refusal, low confidence, and schema drift become `needs_human`, never `qualified`.
- Do not infer an interest level the lead did not state. Unanswered questions are `unknown` or `not_disclosed`, not guesses.
- CRM writes, meeting bookings, and follow-up scheduling stay with a human.
- Out of scope: medical, legal, financial, emergency, collections, and political calls.