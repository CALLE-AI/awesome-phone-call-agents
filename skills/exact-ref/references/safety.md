# Safety

This skill places no calls. `scripts/exactref.mjs` reads JSON and prints a decision; it never reads CALL-E credentials and never invokes an MCP tool. Live calling stays with the host.

If the host does place the call that this skill later gates:

- Only on explicit user intent, to a user-named E.164 number. Do not guess phone numbers, country codes, language, region, `plan_id`, `confirm_token`, or `run_id`.
- Never create a second call because top-level status is `queued`. `queued` plus attempt activity is an active call.
- Do not treat a local wait timeout as cancellation. CALL-E has no client cancel after accept.
- Do not print API keys, OAuth tokens, `confirm_token`, or raw destination numbers. Show a destination label.
- Do not put the intended identifier, private account numbers, or real customer names in the outbound task. `compile` exits `2` if the intended value leaks.
- Do not treat unsigned CALL-E webhooks as authority. Re-fetch the stored call id with the API key.
- Do not invoke `track_ui_events` or any undocumented MCP tool.

Writes:

- Do not write `mismatch`, `spoken_only`, `conversational_confirmed`, or `unknown` into a system of record as a verified fact. Only `independently_verified` is writable, and only after a human types the value and claims a second channel (email, portal, paper).
- Mask identifiers in summaries when they are longer than four characters: keep the last four, replace the rest with `•`.

Scope:

- Medical, legal, emergency, and payment-card content is out of scope.
- Recurring schedules are out of scope; nothing is scheduled, so there is nothing to cancel.
- Fixtures in `references/` are synthetic. They are modeled on one authorized 2026-09-05 call but contain no transcript, recording, phone number, or personal data.
