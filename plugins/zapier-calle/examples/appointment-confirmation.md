# Recipe: Appointment confirmation by phone

## Problem

A calendar event is coming up and someone needs to confirm the person is
still available before the slot is wasted on a no-show. A short confirmation
call the day before, logged automatically to a sheet, replaces a manual
phone tree and gives a human a clear list of who confirmed, who wants to
reschedule, and who canceled.

## Zap shape

1. **Trigger:** Google Calendar - Event Start. Fires ahead of an upcoming
   calendar event (configure the trigger's lead time in Zapier, for example
   one day before).
2. **Action:** CALL-E - Place Call and Wait for Outcome. Calls the person
   attached to the event and waits for the terminal outcome.
3. **Action:** Google Sheets - Create Spreadsheet Row. Logs the outcome to a
   tracking sheet.

This is the recipe a judge can reproduce with only free accounts: Google
Calendar and Google Sheets both have free tiers. The Zapier plan itself
still needs to be paid because of the three-step shape - see
[Zapier plan needed](#zapier-plan-needed) below.

## Call Task text

Map the Call Task field to:

```
Call this person to confirm their upcoming appointment.
Appointment: {{1.event_title}} on {{1.event_start_time}}.
Ask them to confirm whether that time still works for them.
If they want a different time, ask what time would work better and record
it in their own words.
If they need to cancel entirely, let them do so - do not talk them out of
it - and note that clearly.
At the end of the call, state clearly whether they confirmed, want to
reschedule, or canceled.
```

Recipient Phone Number: map from the phone number stored on the calendar
event (for example in the event description or a linked guest field), which
must already be in E.164 format, for example `+15550123456`.

## Result Schema

```json
{
  "type": "object",
  "properties": {
    "confirmed": {
      "type": "string",
      "enum": ["yes", "no", "reschedule", "unknown"],
      "description": "Use yes when the person confirms the stated time. Use reschedule when they want a different time. Use no when they cancel. Use unknown when the call did not establish this."
    },
    "preferred_time": {
      "type": "string",
      "description": "The alternative time in the person's own words when confirmed is reschedule. Empty string otherwise."
    }
  },
  "required": ["confirmed"],
  "additionalProperties": false
}
```

## Routing table

| Disposition | Sub-case | Action taken |
| --- | --- | --- |
| `confirmed` | `result_confirmed = yes` | Log a "Confirmed" row to the sheet. No further action needed. |
| `confirmed` | `result_confirmed = reschedule` | Log a "Reschedule requested" row with `result_preferred_time`. A human rebooks the appointment. |
| `confirmed` | `result_confirmed = no` | Log a "Canceled" row. A human frees up the slot. |
| `confirmed` | `result_confirmed = unknown` | Log an "Ambiguous - needs review" row. A human calls back. |
| `review_required` | - | Log a "Needs review" row with `disposition_reason`. A human calls back. |
| `result_invalid` | - | Log a "Needs review" row with `disposition_reason`. A human calls back. |
| `failed` | - | Log a "Call failed - retry" row with `disposition_reason`. A human retries or calls back manually. |
| `canceled` | - | Log a "Call canceled" row with `disposition_reason`. A human decides whether to retry. |
| `outcome_unknown` | - | Log a "Still in progress - recheck" row. Do not treat this as a failed or missed call - see the note below. |
| `needs_human` | - | Log a "Needs review" row with `disposition_reason`. A human calls back. |
| `outside_calling_window` | - | Log a "Not called - outside calling window" row with `disposition_reason`. No call was placed; a human reschedules the confirmation call for the next allowed hour rather than treating a no-show as a decline. |

Only `confirmed` with `result_confirmed = yes` needs no follow-up. Every
other outcome, including an ambiguous `confirmed` result, gets logged for a
human to act on rather than being silently treated as a successful
confirmation.

**Note on `outcome_unknown` and `queued`:** in a live test call, a call sat
at status `queued` for over two minutes while the phone was actually ringing
and being answered - it never showed `in_progress`. If a `Place Call and
Wait for Outcome` step is interrupted, or you build a separate
reconciliation Zap with `Find Call Result`, a call still in that state
reports `outcome_unknown`, not a failure. Recheck it later with
`Find Call Result` using the recorded `call_id` rather than assuming the
call did not go through.

## Zapier plan needed

Paid. `[trigger] -> [Place Call and Wait]` alone is a two-step Zap and runs
on the free plan, but the Google Sheets writeback step makes this a
three-step Zap, which requires a paid Zapier plan. The Google Calendar and
Google Sheets accounts themselves are free.

## What to check before turning it on

- Set Region and Locale explicitly on the call step. CALL-E never infers
  them from the phone number, and a live test call to a number outside the
  assumed default region returned `HTTP 422` with error code
  `call_not_ready` and a `details.questions` array asking which language to
  use before it would place the call. If appointments span multiple
  countries, map Region and Locale from a calendar or contact field rather
  than leaving them blank, or the call may be rejected until the question is
  answered.
- Confirm the phone number field on your calendar events is populated and in
  E.164 format before the Zap runs against real appointments.
- Confirm the Google Sheet has columns matching every field you map
  (`disposition`, `result_confirmed`, `result_preferred_time`,
  `disposition_reason`, and so on) before turning the Zap on.
- Leave Dry Run set to `true` and run the Zap against a real or test
  calendar event first. Confirm the Call Task text reads correctly with real
  field values substituted in, and confirm each routing outcome writes the
  row you expect to the sheet.
- Only then turn Dry Run off deliberately. Do this last, after everything
  else has been verified.
