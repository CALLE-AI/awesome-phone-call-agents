# Recipe: Incident escalation by phone

## Problem

An on-call rotation needs a primary engineer paged by phone for a live
incident, with an automatic escalation to a backup engineer if the primary
does not clearly acknowledge. Text and app notifications get missed; a phone
call that asks a direct yes/no question and records the answer does not.

## Zap shape

1. **Trigger:** Webhooks by Zapier - Catch Hook. Your incident/alerting
   system (PagerDuty, Opsgenie, a custom alert script, and so on) posts a
   JSON body here when a new incident opens. This recipe assumes the body
   includes at least an incident title, a severity, and a summary.
2. **Action:** CALL-E - Place Call and Wait for Outcome. Calls the primary
   on-call engineer and waits for the terminal outcome.
3. **Action:** Filter by Zapier. Only continue if `disposition` is not
   `confirmed` OR `result_acknowledged` is not `yes`. In other words: continue
   past the filter for every case except a clean acknowledgment, so the Zap
   proceeds to escalation whenever the primary engineer did not clearly say
   yes.
4. **Action:** CALL-E - Place Call and Wait for Outcome. Calls the backup
   on-call engineer as the escalation.

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
      "enum": ["yes", "no", "unknown"],
      "description": "Use yes only when the engineer clearly states they are taking the incident now. Use no when they decline or cannot take it. Use unknown when the call did not establish this."
    },
    "eta_minutes": {
      "type": "string",
      "description": "Minutes until the engineer starts, as stated by them. Empty string when not stated."
    }
  },
  "required": ["acknowledged"],
  "additionalProperties": false
}
```

## Routing table

| Disposition | Sub-case | Action taken |
| --- | --- | --- |
| `confirmed` | `result_acknowledged = yes` | Stop. Incident acknowledged; no escalation call is made. |
| `confirmed` | `result_acknowledged = no` or `unknown` | Escalate: continue to the backup engineer call. |
| `review_required` | - | Escalate: continue to the backup engineer call. |
| `result_invalid` | - | Escalate: continue to the backup engineer call. |
| `failed` | - | Escalate: continue to the backup engineer call. |
| `canceled` | - | Escalate: continue to the backup engineer call. |
| `outcome_unknown` | - | Escalate: continue to the backup engineer call. Do not treat this as a failed page - it means the call has not reached a terminal state yet (see the note below). |
| `needs_human` | - | Escalate: continue to the backup engineer call. |

This table has no row for `outside_calling_window` on purpose: leave
`Recipient Timezone (IANA)` blank on both call steps in this recipe. The
calling-window guard exists to stop a solicitation-style call from dialing
someone at 3am; a page for a live incident is the opposite case - an outage
does not respect business hours, and a guard that silently deferred the
primary's page until 8am would turn "escalate immediately" into "escalate
after sleeping on it." If you do set a timezone here anyway (for example, a
non-urgent, business-hours-only rotation), route `outside_calling_window`
the same as every other non-`confirmed` disposition above: escalate to the
backup engineer, since a page that never dialed is exactly as unacknowledged
as one that failed.

Escalating on ambiguity is deliberate. Only `confirmed` with
`result_acknowledged = yes` stops the ladder; every other outcome, including
an outcome that simply could not be classified, pages the backup engineer.
A missed page costs far more than a duplicate one, so this recipe is built
to over-page rather than under-page.

**Note on `outcome_unknown` and `queued`:** in a live test call, a call sat
at status `queued` for over two minutes while the phone was actually ringing
and being answered - it never showed `in_progress`. `Find Call Result` on a
call in that state reports `outcome_unknown`, not a failure. If you build a
separate reconciliation Zap around `Find Call Result` instead of using
`Place Call and Wait for Outcome`, do not treat `outcome_unknown` as proof
the page failed; it may just mean the call is still ringing.

## Zapier plan needed

Paid. `[trigger] -> [Place Call and Wait]` alone is a two-step Zap and runs
on the free plan, but this recipe adds a Filter step and a second call
action, making it a four-step Zap. Multi-step Zaps beyond a single
trigger-and-action pair require a paid Zapier plan.

## What to check before turning it on

- Set Region and Locale explicitly on both call steps. CALL-E never infers
  them from the phone number, and a live test call to a number outside the
  assumed default region returned `HTTP 422` with error code
  `call_not_ready` and a `details.questions` array asking which language to
  use before it would place the call. Leaving Region and Locale blank can
  cause CALL-E to reject the request until that question is answered.
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
