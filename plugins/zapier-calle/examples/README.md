# Example recipes

Three concrete, runnable Zap recipes built on the Zapier CALL-E integration.
Each one names the exact apps, trigger, and actions to use; gives
copy-pasteable Call Task text; a complete Result Schema; a routing table
covering all seven dispositions; the Zapier plan you need; and what to
verify before you let it place real calls.

| Recipe | Purpose |
| --- | --- |
| [`incident-escalation.md`](./incident-escalation.md) | Page an on-call engineer by phone and automatically escalate to a backup if they do not clearly acknowledge. |
| [`lead-qualification.md`](./lead-qualification.md) | Call a new CRM contact to gauge interest and timeline, and hand off to a human on anything less than a clean result. |
| [`appointment-confirmation.md`](./appointment-confirmation.md) | Call ahead of a calendar event to confirm, reschedule, or cancel, and log the outcome to a sheet. |

## Shared note

Every recipe ships with Dry Run set to `true`. Follow the recipe's own
"What to check before turning it on" section, verify the Zap behaves as
expected, and only then turn Dry Run off deliberately - it is never turned
off as part of copying the recipe.

Every recipe also sets Region and Locale explicitly rather than leaving them
blank. CALL-E does not infer either from the phone number, and can reject a
call with `HTTP 422` and error code `call_not_ready` until the missing
information is supplied. See each recipe's "What to check" section for
details.
