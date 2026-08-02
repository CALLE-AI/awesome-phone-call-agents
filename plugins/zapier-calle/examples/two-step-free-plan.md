# Recipe: Two-step Zap that runs on the free plan

## Problem

The other three recipes in this directory all end with a writeback step
(a sheet row, a CRM property, an escalation call), and that third step is
what pushes them onto a paid Zapier plan. Someone on Zapier's free plan -
including a reviewer or a community member evaluating this integration for
the first time - cannot run any of them. This recipe has no writeback step,
so it runs on the free plan, and it is the recipe to run first: it confirms
the integration places a call and reports a disposition correctly, before
you build anything that writes the result somewhere else.

## Zap shape

1. **Trigger:** Schedule by Zapier - Every Day (or any interval). A
   built-in Zapier trigger, so this Zap needs no third-party app connection
   at all beyond the CALL-E connection itself.
2. **Action:** CALL-E - Place Call and Wait for Outcome. Calls a number you
   choose and waits for the terminal outcome.

That is the whole Zap. There is no third step. Nothing writes the result
anywhere automatically - you read it from the Zap's run history in the
Zapier UI, where every output field this action returns, including
`disposition`, `disposition_reason`, `summary`, and `transcript_text`, is
visible on the run detail page.

## Call Task text

Map the Call Task field to something simple enough to verify by ear, for
example:

```
Call this person and ask them to say their favorite color out loud.
At the end of the call, state clearly what color they said, or state
clearly that they did not answer or did not say a color.
```

Recipient Phone Number: a number you are authorized to call, in E.164
format, for example `+15550123456`.

Region: set explicitly, for example `US`. Locale: set explicitly, for
example `en-US`. See
[What to check before turning it on](#what-to-check-before-turning-it-on)
for why leaving either blank can stop the call before it starts.

## Result Schema

```json
{
  "type": "object",
  "properties": {
    "color": {
      "type": "string",
      "description": "The color the person said, in their own words. Empty string if they did not say one."
    },
    "answered": {
      "type": "string",
      "enum": ["yes", "no"],
      "description": "Use yes if the person answered and spoke with the agent at all. Use no if the call was not answered."
    }
  },
  "required": ["answered"],
  "additionalProperties": false
}
```

## Routing table

There is no third Zap step, so nothing below happens automatically. This
table describes what you, reading the run history, would do next for each
disposition - not an action the Zap takes on your behalf.

| Disposition | What you would do next |
| --- | --- |
| `confirmed` | Read `result_color` and `result_answered` in the run's output. The call worked end to end and extracted a validated result. |
| `review_required` | Read `disposition_reason`. The call completed but CALL-E did not consider the task completed, was not highly confident, or extracted no usable result - decide by hand whether to call again. |
| `result_invalid` | Read `disposition_reason`. CALL-E could not validate the extracted result against the Result Schema above - check the schema and the Call Task text agree with each other. |
| `failed` | Read `disposition_reason` and `failure_code`. The call itself failed - decide by hand whether to retry. |
| `canceled` | Read `disposition_reason`. The call was canceled before it completed. |
| `outcome_unknown` | Read `disposition_reason`. The call has not reached a terminal state, or the callback payload was unreadable. Do not conclude the call failed or that the person was not reached - see the note below - and check back later with `Find Call Result` using the run's `call_id`. |
| `needs_human` | Read `disposition_reason`. The fail-closed default: a malformed event, an unrecognized status, or a callback that failed identity verification. Treat it as unresolved, not as a specific known outcome. |

**Note on `outcome_unknown` and `queued`:** in a live test call, a call sat
at status `queued` for a 300-second polling window while the phone was
actually ringing and being answered, and never showed `in_progress`. With
no writeback step to hide behind, this Zap's run history will show
`outcome_unknown` in exactly that situation - that is expected behavior,
not a broken Zap, and it is not evidence the call did not go through.

## Zapier plan needed

Free. This is a two-step Zap - one trigger, one action, no writeback - and
Zapier's free plan supports two-step Zaps with unlimited built-in and
Premium app steps. Schedule by Zapier is a built-in trigger, so no
additional app connection is required beyond the CALL-E connection.

## What to check before turning it on

- Set Region and Locale explicitly, as shown above. CALL-E never infers
  either from the phone number, and can reject call creation with
  `HTTP 422` and error code `call_not_ready`, returning a
  `details.questions` array asking for the missing information, until both
  are supplied.
- Confirm the phone number is E.164 format and one you are authorized to
  call.
- Leave Dry Run set to `true` first and run the Zap once. Open the run in
  Zapier's run history and confirm the Call Task text and phone number read
  correctly, and that the preview output looks as expected. Places no call.
- Only then turn Dry Run off deliberately, as its own explicit step, after
  you have confirmed the dry run looks right.
- Run this recipe first, confirm the integration places a call and reports
  a disposition you can read correctly in the run history, and only then
  move on to a recipe that adds a writeback step.
