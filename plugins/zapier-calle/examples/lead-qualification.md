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
   contact and waits for result readiness.
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
      "enum": [
        "strong",
        "moderate",
        "none",
        "unknown"
      ],
      "description": "Use strong when the prospect asks about pricing, a demo, or next steps. Use moderate when they are curious but not ready. Use none when they decline. Use unknown when the call did not establish this."
    },
    "timeline": {
      "type": "string",
      "enum": [
        "this_month",
        "this_quarter",
        "later",
        "unknown"
      ],
      "description": "When the prospect says they intend to decide."
    },
    "callback_requested": {
      "type": "string",
      "enum": [
        "yes",
        "no",
        "unknown"
      ],
      "description": "Use yes only when the prospect explicitly asks to be called back."
    },
    "business_confirmed": {
      "type": "boolean",
      "description": "True only when the recipient clearly states their interest level. False when it remains unknown or unsupported."
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
    "interest_level",
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

| Disposition | Action taken |
| --- | --- |
| `confirmed` | Write `result_interest_level`, `result_timeline`, and `result_callback_requested` onto the HubSpot custom properties. No task is created. |
| `review_required` | Do not write the interest-level property. Create a HubSpot task for a human and write `disposition_reason` to the contact note. |
| `failed` | Same as `review_required`: create a task for a human, write `disposition_reason` to the note. |
| `canceled` | Same as `review_required`: create a task for a human, write `disposition_reason` to the note. |
| `outcome_unknown` | Same as `review_required`: create a task for a human, write `disposition_reason` to the note. Do not conclude the call failed - it may simply not have reached a terminal state yet (see the note below). |
| `needs_human` | Same as `review_required`: create a task for a human, write `disposition_reason` to the note. |
| `outside_calling_window` | No call was placed. Create a HubSpot task to call back during the allowed window and write `disposition_reason` to the note - do not treat a fresh lead this way as uninterested. |
| `suppressed` | No call was placed. Create a HubSpot task noting the contact is on the Do Not Call List and write `disposition_reason` to the note - do not dial this contact through another Zap step either. |
| `retry_policy_blocked` | No call was placed - this lead has already been attempted too recently. Leave the record for the next run rather than creating a task; nothing needs a human yet. |

**Handle `opt_out_requested` before the table above.** If it is `true`, the
contact asked not to be called again during the call. Set the HubSpot
do-not-call property, append the number to the Do Not Call List your other
Zaps read from, and stop - regardless of what the qualification answer was.
The integration will already have set `disposition` to `needs_human` and
`lead_state` to `blocked_compliance`, so a `lead_state` filter catches this
case without a separate branch.

Only `confirmed` writes the qualification data onto the record as
authoritative. Every other disposition routes to a human task instead of
guessing at an interest level from an incomplete or unreadable call.

**This is the recipe where the usable-result check earns its place.** CALL-E's
own documentation uses lead qualification as its worked example, with an
`interest_level` enum whose members include `unknown` - the value the model
returns when the prospect never gave enough evidence. Declare
`interest_level` required in your `Result Schema` and a call that comes back
`unknown` is classified `review_required`, not `confirmed`, so it can never
be written onto the record as an interest level. Without that check, "we
could not tell" is stored as a qualification.

**Reconciliation:** read the original API `call_id` while `result_status` is
`pending`, even when `status` is `completed`. Final unavailable results and
uncertain creation require manual review. Do not create a replacement call
just because a callback is late.

## Zapier plan needed

Paid. `[trigger] -> [Place Call and Wait]` alone is a two-step Zap and runs
on the free plan, but the HubSpot Update Contact writeback step makes this a
three-step Zap, which requires a paid Zapier plan. (HubSpot's own free CRM
tier also has its own limits on custom properties and workflow actions,
independent of your Zapier plan.)

## What to check before turning it on

- Region and Locale are optional in v2. Set them explicitly when the intended
  destination and spoken language are known. Conflicts or ambiguity return
  `input_incomplete` with `details.missing_inputs`; correct the input before
  acceptance. Preserve the exact original hints on an uncertain replay.
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
