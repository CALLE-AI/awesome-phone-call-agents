# Safety

- Explicit consent on the intake **and** `--confirm-consent` on the CLI.
- E.164 only. Mask phones in logs and video.
- Never commit `CALLE_API_KEY`. Live calls only go to `https://api.heycall-e.com`.
- One-shot. No hidden retries or recurring schedules.
- Fail closed: silence, voicemail, low confidence, and schema drift become `needs_human`.
- The agent discloses it is AI. Wrong-person ends the call.
- Out of scope: medical, legal, financial, emergency, collections, political, unsolicited marketing.
- Calendar writes stay with a human, including every reschedule request.
