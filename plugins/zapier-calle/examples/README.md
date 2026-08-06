# Example recipes

Four concrete, runnable Zap recipes built on the Zapier CALL-E integration.
Each one names the exact apps, trigger, and actions to use; gives
copy-pasteable Call Task text; a complete Result Schema; a routing table
covering all ten dispositions; the Zapier plan you need; and what to
verify before you let it place real calls.

| Recipe | Purpose | Zapier plan |
| --- | --- | --- |
| [`two-step-free-plan.md`](./two-step-free-plan.md) | Place a call on a schedule and read the outcome from the Zap's run history. No writeback step. Run this one first to confirm the integration works end to end. | Free |
| [`incident-escalation.md`](./incident-escalation.md) | Page an on-call engineer by phone and automatically escalate to a backup if they do not clearly acknowledge. | Paid |
| [`lead-qualification.md`](./lead-qualification.md) | Call a new CRM contact to gauge interest and timeline, and hand off to a human on anything less than a clean result. | Paid |
| [`appointment-confirmation.md`](./appointment-confirmation.md) | Call ahead of a calendar event to confirm, reschedule, or cancel, and log the outcome to a sheet. | Paid |

Only `two-step-free-plan.md` runs on Zapier's free plan - it is a two-step
Zap (trigger, then call) with no writeback step. The other three each add a
third step that writes the outcome somewhere (a filter plus escalation
call, a CRM update, a sheet row), and a three-or-more-step Zap requires a
paid Zapier plan regardless of which apps those steps use.

## Shared note

Every recipe ships with Dry Run set to `true`, which is also where the field
starts on its own: a newly added action previews rather than calling anyone,
and a blank value counts as a preview too. Follow the recipe's own "What to
check before turning it on" section, verify the Zap behaves as expected, and
only then turn Dry Run off deliberately - it is never turned off as part of
copying the recipe.

Every recipe also sets Region and Locale explicitly rather than leaving them
blank. CALL-E does not infer either from the phone number, and can reject a
call with `HTTP 422` and error code `call_not_ready` until the missing
information is supplied. See each recipe's "What to check" section for
details.

None of these recipes set `Recipient Timezone (IANA)` or `Do Not Call
List`, so none of them enforce a calling window or a suppression list out
of the box. If you add either one, every routing table except
`incident-escalation.md`'s has a row for the resulting
`outside_calling_window`, `suppressed` or `retry_policy_blocked` disposition - a call refused
before dialing, not a result of one. `incident-escalation.md` explains why
a paging recipe should generally leave both guards disabled instead.
