# Recipe: Incident escalation by phone

## Problem

An on-call rotation needs a primary engineer paged by phone for a live
incident, with an automatic escalation to a backup engineer if the primary
is confirmed unreachable. Text and app notifications get missed; a phone
call that asks a direct yes/no question and records the answer does not.

## Zap shape

1. **Trigger:** Webhooks by Zapier - Catch Hook. Your incident/alerting
   system (PagerDuty, Opsgenie, a custom alert script, and so on) posts a
   JSON body here when a new incident opens. This recipe assumes the body
   includes at least an incident title, a severity, and a summary.
2. **Action:** CALL-E - Place Call and Wait for Outcome. Calls the primary
   on-call engineer and waits for result readiness.
3. **Action:** Filter by Zapier. Continue to the backup only when the primary's
   result is no longer pending, `call_outcome` is `no_answer` or `busy`, and
   `opt_out_requested` is false. Route uncertainty, refusal, cancellation,
   technical errors, or an unsupported business answer to a human.
4. **Action:** CALL-E - Place Call and Wait for Outcome. Calls the authorized
   backup on-call engineer as a separate logical Call.

This is a four-step Zap (trigger, call, filter, call), so it needs a paid
Zapier plan - see [Zapier plan needed](#zapier-plan-needed) below.

## Call Task text

Map the primary engineer's Call Task field to:

```
Call this on-call engineer about an active incident.
Incident: {{1.incident_title}}. Severity: {{1.severity}}.
Summary: {{1.summary}}.
Ask the engineer to confirm whether they are taking this incident right now.
If they say yes, ask how many minutes until they will start working the
incident and record that number as spoken.
If they say no, or they cannot take it, or they are not sure, do not press
further - just note their answer.
At the end of the call, state clearly and unambiguously whether the engineer
acknowledged taking the incident.
```

Use the same text for the backup engineer's call in step 4, with
"on-call engineer" replaced by "backup on-call engineer" if you want the
backup to know they are the second call.

Recipient Phone Number for the primary engineer step: the primary's number,
for example `+15550123456`. Recipient Phone Number for the backup engineer
step: the backup's number, for example `+15550199999`. Set Region and Locale
explicitly on both call steps - see
[What to check before turning it on](#what-to-check-before-turning-it-on).

## Result Schema

```json
{
  "type": "object",
  "properties": {
    "acknowledged": {
      "type": "string",
      "enum": [
        "yes",
        "no",
        "unknown"
      ],
      "description": "Use yes only when the engineer clearly states they are taking the incident now. Use no when they decline or cannot take it. Use unknown when the call did not establish this."
    },
    "eta_minutes": {
      "type": "string",
      "description": "Minutes until the engineer starts, as stated by them. Empty string when not stated."
    },
    "business_confirmed": {
      "type": "boolean",
      "description": "True only when the engineer explicitly agrees to take this incident now. False for refusal, uncertainty, or no answer."
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
    "acknowledged",
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

| Disposition | Sub-case | Action taken |
| --- | --- | --- |
| `confirmed` | `is_actionable = true` and `result_acknowledged = yes` | Stop; the engineer acknowledged taking the incident. |
| `review_required` | Final `no_answer` or `busy`, no opt-out | Call the separately authorized backup. |
| any | `opt_out_requested = true` | Stop the calling ladder and hand off to a human. |
| any other result | Including pending, unavailable, declined, canceled, technical error or failed verification | Reconcile the original Call or hand off to a human. No automatic replacement call. |

An on-call policy may intentionally permit paging outside normal calling
hours, but configure that policy explicitly. Do not bypass suppression or
opt-out because a page is urgent. Retry histories belong to each target
number; the primary and backup are separate contacts.

**Reconciliation:** keep the API `call_id` and interface. Read the same Call
while `result_status` is pending. A timeout cannot establish whether the
primary was reached, and does not authorize another call to that person.

## Zapier plan needed

Paid. `[trigger] -> [Place Call and Wait]` alone is a two-step Zap and runs
on the free plan, but this recipe adds a Filter step and a second call
action, making it a four-step Zap. Multi-step Zaps beyond a single
trigger-and-action pair require a paid Zapier plan.

## What to check before turning it on

- Region and Locale are optional in v2. Set them explicitly when the intended
  destination and spoken language are known. Conflicts or ambiguity return
  `input_incomplete` with `details.missing_inputs`; correct the input before
  acceptance. Preserve the exact original hints on an uncertain replay.
- Confirm the primary and backup phone numbers are correct and that you are
  authorized to call both of them.
- Leave Dry Run set to `true` on both call steps and run the Zap against a
  real or synthetic incident payload first. Confirm the Call Task text reads
  correctly with real field values substituted in, and confirm the Filter
  step's logic sends a Dry Run confirmed-yes test down the "stop" path and
  everything else down the escalation path.
- Only then turn Dry Run off deliberately on both steps. Do this last, after
  everything else has been verified.
- Confirm your incident source actually posts to the Catch Hook URL with the
  field names this recipe assumes (`incident_title`, `severity`, `summary`)
  and adjust the Call Task mapping if your payload uses different names.
