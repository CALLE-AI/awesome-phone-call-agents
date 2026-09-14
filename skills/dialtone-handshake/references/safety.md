# Safety

## Before dialling

- Get explicit intent for each call. Confirm the destination as an E.164 number you are authorised to call.
- Keep the AI disclosure first. The DIALTONE token supplements disclosure; it never replaces it.
- When the counterpart type is uncertain, use HUMAN mode. Treating a person as a machine costs them disclosure and a humane pace, which is worse than spending a few extra seconds on a bot.
- Do not use DIALTONE to make emergency, medical, legal or financial commitments on the strength of an AI agent's word.
- Mask real phone numbers in logs and summaries. Do not commit transcripts of real calls.

## After dialling

- Never report a binding commitment as done when the gate says `refused` or `unverified`.
- Treat `agent_asserted` confirmation codes as claims. Re-verify them through the business's own channel (website, email, human callback) before relying on them.
- An acknowledgement with a wrong or missing nonce is not a verified DIALTONE agent. Record it and fall back to behavioural detection.
- The detector is experimental. Its measured error rates are in `apps/python/dialtone/eval/REPORT.md`. Do not use its output to make high-stakes decisions automatically.
