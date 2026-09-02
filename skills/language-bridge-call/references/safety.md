# Safety

- Explicit consent in the request JSON **and** `--confirm-consent` on the CLI before any live run.
- Both numbers must come from the requester's own records. E.164 only. Mask phones in logs, previews, and video.
- At most two calls per request: one to the recipient, one to the requester. No hidden retries, no voicemail callbacks, no schedules.
- The agent discloses it is AI on both calls. Wrong person ends the call.
- Not an interpretation service: no medical, legal, financial, insurance, government, or emergency content. Relay logistics only.
- Fail closed: voicemail, no-answer, no-consent, low confidence, and schema drift become `needs_human`. Never treat silence or a non-answer as agreement. Consent must arrive as an explicit `consent_given: true` in the structured answer; a missing or mistyped field refuses the requester call.
- The agent relays; it never negotiates, promises, amends the request text, or invents new windows. Windows come only from `proposed_windows`.
- Never commit `CALLE_API_KEY` or tokens. The CLI keeps plan and confirmation data in its own private cache (mode 0600); the script prints run IDs, never tokens.
- If `run_call` is uncertain, stop and surface the CLI recovery command. Do not start a second plan.
- One relay per `request_id`: `--execute` persists state under `~/.cache/language-bridge-call/` and refuses repeats; clear a state file only after verifying no call was placed.
- Result is a relayed confirmation, not an agreement. Any commitment is the humans', reviewed from the structured result.
