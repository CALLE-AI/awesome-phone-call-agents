# Recipe: Lead qualification by phone

## Problem

A new contact lands in your CRM and someone needs to talk to them quickly to
gauge real interest before a sales rep spends time on a call. A short
qualification call, run automatically as soon as the contact is created,
gets the prospect's interest level and timeline on record while the lead is
still warm, and hands off to a human immediately when the answer is not
clear-cut.

## Zap shape

1. **Trigger:** HubSpot - New Contact. Fires when a new contact is created
   in HubSpot.
2. **Action:** CALL-E - Place Call and Wait for Outcome. Calls the new
   contact and waits for the terminal outcome.
3. **Action:** HubSpot - Update Contact. Writes the outcome back onto the
   contact record.

This is a three-step Zap with a writeback step, so it needs a paid Zapier
plan - see [Zapier plan needed](#zapier-plan-needed) below.

## Call Task text

Map the Call Task field to:

```
Call this prospect to qualify their interest in our product.
Introduce yourself briefly, then ask about their current process and
whether they are evaluating solutions like ours.
Ask what is driving them to look now, and when they expect to make a
decision - this month, this quarter, or later.
If they show strong interest (for example, they ask about pricing, a demo,
or next steps), ask if they would like a callback from a specialist and
record whether they said yes.
If they are not interested, thank them for their time and end the call
politely - do not push.
At the end of the call, state clearly: their interest level, their decision
timeline, and whether they asked for a callback.
```

Recipient Phone Number: map from the HubSpot contact's phone field, which
must already be in E.164 format, for example `+15550123456`. If your HubSpot
phone field is not stored in E.164, add a Formatter by Zapier step before
the call step to convert it, or the call step will reject the number.

## Result Schema

```json
{
  "type": "object",
  "properties": {
    "interest_level": {
      "type": "string",
      "enum": ["strong", "moderate", "none", "unknown"],
      "description": "Use strong when the prospect asks about pricing, a demo, or next steps. Use moderate when they are curious but not ready. Use none when they decline. Use unknown when the call did not establish this."
    },
    "timeline": {
      "type": "string",
      "enum": ["this_month", "this_quarter", "later", "unknown"],
      "description": "When the prospect says they intend to decide."
    },
    "callback_requested": {
      "type": "string",
      "enum": ["yes", "no", "unknown"],
      "description": "Use yes only when the prospect explicitly asks to be called back."
    }
  },
  "required": ["interest_level"],
  "additionalProperties": false
}
```

## Routing table

| Disposition | Action taken |
| --- | --- |
| `confirmed` | Write `result_interest_level`, `result_timeline`, and `result_callback_requested` onto the HubSpot custom properties. No task is created. |
| `review_required` | Do not write the interest-level property. Create a HubSpot task for a human and write `disposition_reason` to the contact note. |
| `result_invalid` | Same as `review_required`: create a task for a human, write `disposition_reason` to the note. |
| `failed` | Same as `review_required`: create a task for a human, write `disposition_reason` to the note. |
| `canceled` | Same as `review_required`: create a task for a human, write `disposition_reason` to the note. |
| `outcome_unknown` | Same as `review_required`: create a task for a human, write `disposition_reason` to the note. Do not conclude the call failed - it may simply not have reached a terminal state yet (see the note below). |
| `needs_human` | Same as `review_required`: create a task for a human, write `disposition_reason` to the note. |

Only `confirmed` writes the qualification data onto the record as
authoritative. Every other disposition routes to a human task instead of
guessing at an interest level from an incomplete or unreadable call.

**Note on `outcome_unknown` and `queued`:** in a live test call, a call sat
at status `queued` for over two minutes while the phone was actually ringing
and being answered - it never showed `in_progress`. If you poll
`Find Call Result` for a call that is still in this state, expect
`outcome_unknown`, not a failure; treat it as "still running," not "did not
work."

## Zapier plan needed

Paid. `[trigger] -> [Place Call and Wait]` alone is a two-step Zap and runs
on the free plan, but the HubSpot Update Contact writeback step makes this a
three-step Zap, which requires a paid Zapier plan. (HubSpot's own free CRM
tier also has its own limits on custom properties and workflow actions,
independent of your Zapier plan.)

## What to check before turning it on

- Set Region and Locale explicitly on the call step. CALL-E never infers
  them from the phone number, and a live test call to a number outside the
  assumed default region returned `HTTP 422` with error code
  `call_not_ready` and a `details.questions` array asking which language to
  use before it would place the call. If your contacts span multiple
  countries, map Region and Locale from a HubSpot property rather than
  leaving them blank, or the call may be rejected until the question is
  answered.
- Confirm the HubSpot custom properties (`interest_level`, `timeline`,
  `callback_requested`) exist on the contact object before mapping to them.
- Confirm your organization has a legitimate basis (for example, existing
  consent or an established business relationship) to call this contact -
  outbound sales calls are subject to telemarketing rules such as the TCPA
  in the US, and this recipe does not include consent checking.
- Leave Dry Run set to `true` and run the Zap against a real or test contact
  first. Confirm the Call Task text reads correctly with real field values
  substituted in, and confirm both branches of the routing table (a
  `confirmed` result and a non-`confirmed` result) do what you expect in
  HubSpot.
- Only then turn Dry Run off deliberately. Do this last, after everything
  else has been verified.
