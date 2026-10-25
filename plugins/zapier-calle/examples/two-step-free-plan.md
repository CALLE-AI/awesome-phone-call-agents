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
   choose and waits for result readiness.

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
for how explicit hints resolve ambiguous call intent.

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
      "enum": [
        "yes",
        "no"
      ],
      "description": "Use yes if the person answered and spoke with the agent at all. Use no if the call was not answered."
    },
    "business_confirmed": {
      "type": "boolean",
      "description": "True only when the recipient explicitly states a favorite color. False when no color was established."
    },
    "business_confirmed_quote": {
      "type": "string",
      "description": "Exact recipient words supporting business_confirmed, or unknown when no such evidence exists."
    },
    "summary": {
      "type": "string",
      "description": "Short factual account of the conversation, or unknown when no usable conversation exists."
    }
  },
  "required": [
    "answered",
    "business_confirmed",
    "business_confirmed_quote"
  ],
  "additionalProperties": false
}
```

The schema requests an explicit business decision and its recipient quote.
Automatic steps must check `is_actionable` and the relevant business fields;
`result_status: available` alone is insufficient.

## Routing table

There is no third Zap step, so nothing below happens automatically. This
table describes what you, reading the run history, would do next for each
disposition - not an action the Zap takes on your behalf.

| Disposition | What you would do next |
| --- | --- |
| `confirmed` | Read `result_color` and `result_answered` in the run's output. The call worked end to end and extracted a validated result. |
| `review_required` | Read `disposition_reason`. The call completed but the result was unavailable, the business confirmation was false, or its recipient quote could not be verified - decide by hand whether to call again. |
| `failed` | Read `disposition_reason` and `error_code`. The call itself failed - decide by hand whether to retry. |
| `canceled` | Read `disposition_reason`. The call was canceled before it completed. |
| `outcome_unknown` | Read `disposition_reason`. The call has not reached a terminal state, or the callback payload was unreadable. Do not conclude the call failed or that the person was not reached - see the note below - and check back later with `Find Call Result` using the run's `call_id`. |
| `needs_human` | Read `disposition_reason`. The fail-closed default: a malformed event, an unrecognized status, or a callback that failed identity verification. Treat it as unresolved, not as a specific known outcome. |
| `outside_calling_window` | Read `disposition_reason`. No call was placed at all - it was refused before dialing because the current local time in the recipient's configured timezone fell outside the calling window. Run the Zap again during the allowed window; only reachable if you set `Recipient Timezone (IANA)` on this step. |
| `suppressed` | Read `disposition_reason` and `matched_entry`. No call was placed at all - the recipient number matched an entry on the `Do Not Call List` you supplied. Only reachable if you set `Do Not Call List` on this step. |
| `retry_policy_blocked` | Read `disposition_reason`, `attempts_in_last_day` and `hours_since_last_attempt`. No call was placed at all - the attempt history you supplied says it would be too soon. Only reachable if you set `Previous Attempt Times` on this step. |

Two output fields are worth looking at on any run that is not `confirmed`:
`review_excerpt` is the last thing the recipient said, and
`review_excerpt_offset_seconds` is where in the call they said it. Between
them you usually do not need to read the whole `transcript_text`.

If `opt_out_requested` comes back `true`, the recipient asked not to be
called again. `disposition` will be `needs_human` no matter how well the
call otherwise went; `opt_out_excerpt` quotes the request. Add that number
to a `Do Not Call List` before running this Zap again.

**Reconciliation:** read the original API `call_id` while `result_status` is
`pending`, even when `status` is `completed`. Final unavailable results and
uncertain creation require manual review. Do not create a replacement call
just because a callback is late.

## Zapier plan needed

Free. This is a two-step Zap - one trigger, one action, no writeback - and
Zapier's free plan supports two-step Zaps with unlimited built-in and
Premium app steps. Schedule by Zapier is a built-in trigger, so no
additional app connection is required beyond the CALL-E connection.

## What to check before turning it on

- Region and Locale are optional in v2. Set them explicitly when the intended
  destination and spoken language are known. Conflicts or ambiguity return
  `input_incomplete` with `details.missing_inputs`; correct the input before
  acceptance. Preserve the exact original hints on an uncertain replay.
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
