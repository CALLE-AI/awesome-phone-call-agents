---
name: missed-call-recovery
description: Call a lead back after the business missed their inbound call, apologize, identify the need, classify urgency, offer a booking slot, and return a schema-validated lead result with intent, urgency, and callback slot that posts to the business dashboard.
license: MIT
---

# Missed-Call Recovery

Use this skill when a business missed an inbound call and the caller should be called back before the lead goes cold.

`missed-call-recovery` turns one missed-call event into at most one outbound recovery call, one structured lead result, and one dashboard post. It does not create recurring schedules, call campaigns, or contact lists. The missed-call event itself is the only authorization basis; see [`references/safety.md`](references/safety.md).

The recovery conversation is deliberately narrow: apologize for the missed call, confirm it is a good time, identify the need, classify urgency, offer a booking slot. A call that quotes prices, confirms a booking as final, or handles emergencies is out of scope.

This skill is the outbound recovery leg of CallbackOps, a missed-call lead-recovery agent. The skill itself is portable and does not depend on the CallbackOps deployment; see [`references/dashboard-writeback.md`](references/dashboard-writeback.md) for how lead results reach a business dashboard.

## When To Use

Use this skill for:

- recovering a missed inbound call from a lead within the same working day
- after-hours missed calls that should be recovered the next business morning
- missed-call events delivered by a PBX, voicemail system, or tracking-number webhook
- measuring how many missed calls turn back into booked leads

## When Not To Use

Do not use this skill to:

- call a number whose owner did not just call the business on their own
- redial a caller who declined the recovery call or asked not to be called
- confirm a booking as final, or quote prices, availability, or policy from memory
- give medical, legal, or financial advice, or handle any emergency
- process purchased lead lists, CRM cold lists, or numbers found in any document
- place a second recovery call after a conversation already happened

## Required Fields

For each recovery call, require:

- `eventId` - unique id of the missed-call event, used for dedupe and idempotency
- `callerPhoneNumber` in E.164, exactly as captured by the phone system
- `businessName` for the agent to introduce itself as
- `missedAt` - when the call was missed
- `timezone` - the caller's local zone for working-hours checks

Optional:

- `callerName`
- `language` and `region` hints for the conversation
- `availableSlots` - booking slots a human has pre-approved for offering

Ask for any missing required field. Do not infer a phone number, country code, or timezone from a locale, an IP address, or unrelated prior context.

## Core Workflow

1. Confirm the event is a real, recent missed call from the business's own phone system, and that this `eventId` has not been processed.
2. Check suppression state: never call a number on the do-not-call record or one that already had a recovery conversation for this event.
3. Recover inside the callback window: within 30 minutes during working hours, or at the start of the next business morning for after-hours misses. Working hours require a known `timezone`.
4. Build the call task: goal text and result schema. See [`references/result-schema.md`](references/result-schema.md).
5. Reserve an idempotency key derived from the event, not from a timestamp or random value: `recovery:<eventId>:<digest>` where the digest covers the E.164 destination, goal version, and schema version.
6. Preview first. Run the dry-run path and review the masked output:

   ```bash
   python3 scripts/missed_call_recovery.py --event event.json --state recovery-state.json
   ```

   Dry-run is the default. It places no call and posts nothing.
7. Execute only after the operator confirms that exact preview:

   ```bash
   python3 scripts/missed_call_recovery.py --event event.json --state recovery-state.json \
     --execute --approved-real-calls --poll \
     --output recovery-results.jsonl \
     --dashboard-webhook "$DASHBOARD_URL"
   ```

8. Poll to a terminal status, then validate the returned result against the declared schema. Drop undeclared fields and refuse out-of-enum values rather than coercing them.
9. Classify the outcome before writing anything; see *Outcome Classification*.
10. Post only the fields the outcome permits to the dashboard webhook. Keep the record for retry if the post fails.

Use this shape:

```text
missed-call event -> dedupe + suppression check -> dry-run preview -> approved call
  -> terminal result -> validate -> classify -> dashboard post of permitted fields
```

## Conversation Shape

Keep the call in this order. Allow interruption at any point.

1. **Apologize and identify.** Name the business, say you are sorry the business missed their call, and state that you are calling to help now. Disclose that this is an automated assistant if asked.
2. **Confirm it is a good time.** If not, offer to call back later and end. Do not continue after a soft refusal.
3. **Identify the need.** Ask what they were calling about. One question at a time. Summarize the need in one sentence.
4. **Classify urgency.** `Emergency`, `Urgent`, `Normal`, or `Flexible`. If anything suggests an emergency or safety risk, tell the caller to hang up and contact emergency services, end the call, and flag the event for a human. Never triage an emergency yourself.
5. **Offer booking.** Offer slots only from `availableSlots` when supplied. Never confirm a slot as final; say a person will confirm. Capture the caller's requested time in `callback_slot` as spoken.
6. **Wrap up.** Summarize what happens next, thank them, end.

The agent may answer only from details supplied with the event. For price, availability, policy, or anything contractual, it must say a human will confirm. A recovery call that invents an answer loses more leads than it recovers.

## Result Schema

The point of the call is the structured result, not the transcript. Declare the schema before the call and validate strictly after. Key fields:

| Field | Type | Notes |
| --- | --- | --- |
| `lead_intent` | one of `Booking`, `Quote`, `Support`, `Information`, `WrongNumber`, `NotInterested` | closed set |
| `need_summary` | string | one sentence |
| `urgency` | one of `Emergency`, `Urgent`, `Normal`, `Flexible` | closed set |
| `callback_slot` | string | the requested time as spoken, never parsed into a timestamp by the agent |
| `wants_booking` | boolean | caller asked for a slot |
| `consent_granted`, `disposition`, `disposition_evidence` | safety fields | required in every result |

Full schema and validation rules in [`references/result-schema.md`](references/result-schema.md).

## Outcome Classification

Classify in this order. A populated structured result is not evidence a human was reached or consented.

| Outcome | Condition | Action |
| --- | --- | --- |
| `recovered` | a human took part, `disposition` is `Completed`, consent granted | post lead intent, urgency, callback slot to the dashboard |
| `partial` | `disposition` is `EndedEarly` | post only captured fields, marked partial; no automatic redial |
| `declined` | `disposition` is `Declined` or `DoNotCall`, or consent refused | post nothing about the lead; apply suppression scope below |
| `not-reached` | provider status `NO_ANSWER` or `VOICEMAIL`, or voicemail greeting evidence, with no contradicting speech | one retry permitted inside the cap |
| `needs-review` | unknown, malformed, contradicted, or unreachable-provider results | no automatic retry; route to a human |

`Declined` suppresses this workflow for the event. `DoNotCall` suppresses all outbound calling to that number and must propagate to the shared do-not-call record. Only a human-confirmed outcome may suppress a number; a missed call never does.

## Attempts and Cancellation

- One missed-call event yields at most one conversation and at most two attempts total.
- Retry only on `not-reached` evidence from the closed set above. Never retry `declined`, `partial`, or `needs-review` automatically.
- Space attempts by at least 30 minutes, inside the caller's local working hours.
- A client timeout or provider error is `needs-review`, never `not-reached`. A call may have connected and been refused. Do not redial an unknown outcome.
- Every pending retry is cancellable by stable id. Cancel automatically when a conversation completes, the caller declines or requests do-not-call, the cap is reached, or an operator cancels.

## Dashboard Writeback

After a permitted outcome, the skill posts one JSON payload to the configured business dashboard webhook: outcome, masked caller number, lead intent, need summary, urgency, callback slot, and attempt metadata. The dashboard token comes from the `CALLBACKOPS_DASHBOARD_TOKEN` environment variable and is never logged. A failed post is retried with `--post-dashboard` without placing another call. See [`references/dashboard-writeback.md`](references/dashboard-writeback.md).

`callback_slot` is a request, not a booking. A person confirms it. The dashboard must treat the slot as pending until a human does.

## Testing Status

State honestly, and keep this section current:

- Verified: the dry-run path, E.164 and required-field validation, event dedupe, result-schema validation on fixture results, phone masking, and dashboard posting against a local receiver. Run the no-call test suite with `scripts/test-missed-call-recovery.sh` (uses a fake CALL-E CLI; places no real call).
- Not verified: a live outbound CALL-E call end to end. Live-call testing is pending the operator's CALL-E account activation. The script's preflight reports the account state, and `--execute` still requires explicit `--approved-real-calls`, but no recovery call has been placed to a real recipient yet. Update this section with observed results once activation completes.

Never state that a call was placed unless the provider call actually ran and returned success.

## Safety Rules

Read [`references/safety.md`](references/safety.md) for the full contract. Always:

- Treat every call as a real-world side effect with a cost.
- Call only the E.164 number from the missed-call event, only once per event, and only inside the callback window.
- Disclose the automated assistant when asked, and honor refusal immediately and permanently.
- Mask phone numbers in summaries, dashboards, logs, and the dashboard payload.
- Never expose API keys, dashboard tokens, or webhook URLs in output.
- Never quote prices, availability, or policy from memory, and never confirm a booking as final.
- Route emergencies, and medical, legal, or financial judgment, to a human.

## Output Format

After an attempt, report:

- outcome, one of `recovered`, `partial`, `declined`, `not-reached`, or `needs-review`
- masked caller number and `eventId`
- `disposition` and the `disposition_evidence` supporting it
- validated lead fields the outcome permits, and any field that failed validation
- whether the dashboard post succeeded, was skipped with the reason, or was kept for retry
- attempt number out of the cap, and the retry decision: scheduled with its window, cancelled with its trigger, or not permitted
- the idempotency key used

If no call was placed, report `status: not called`, the exact blocker, and what the operator must supply next.

Never report a lead as recovered, interested, or booking without a `Completed` disposition, granted consent, and a validated result to support it.

## References

- [`references/safety.md`](references/safety.md): authorization basis, disclosure, suppression, retention, and stop conditions
- [`references/result-schema.md`](references/result-schema.md): the full result schema and validation rules
- [`references/dashboard-writeback.md`](references/dashboard-writeback.md): dashboard payload, credential handling, and the CallbackOps reference deployment
- [`references/examples.md`](references/examples.md): dry-run, recovery, not-reached, and declined examples
