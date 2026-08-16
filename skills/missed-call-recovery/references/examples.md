# Examples

These examples show how `missed-call-recovery` turns one missed-call event into at most one recovery call, one validated lead result, and one dashboard post — including the cases where it must post nothing and call no one.

The phone numbers in these examples use reserved fictional 555-01xx numbers.

## Dry-Run Preview

Missed-call event:

```json
{
  "eventId": "mc-2026-08-15-000042",
  "callerPhoneNumber": "+15551230142",
  "callerName": "Dana",
  "businessName": "Example Dental",
  "missedAt": "2026-08-15T17:41:00-07:00",
  "timezone": "America/Los_Angeles",
  "language": "English",
  "availableSlots": ["2026-08-16 09:00", "2026-08-16 11:30", "2026-08-17 14:00"]
}
```

Dry run (default, no call placed):

```bash
python3 scripts/missed_call_recovery.py --event event.json --state recovery-state.json
```

```text
DRY-RUN: no call will be placed
event          mc-2026-08-15-000042
caller         +1555****0142 (Dana)
business       Example Dental
idempotency    recovery:mc-2026-08-15-000042:a1b2c3d4
dashboard      set (env)
goal           180 words, opens with apology + disclosure
schema         10 properties, 3 required
approve with   --execute --approved-real-calls
```

## Recovered Lead

Conversation shape, abbreviated:

```text
agent     Hi Dana, this is Example Dental — we're sorry we missed your call earlier. I'm calling to help now. Is this a good moment?
caller    Oh, yes, thanks for calling back.
agent     What were you calling about?
caller    I chipped a tooth and want to be seen this week.
agent     That sounds urgent. We have openings tomorrow at 9:00 or 11:30 — a person will confirm whichever you prefer.
caller    Tomorrow at 9 if possible.
agent     Great — someone from the office will confirm shortly. Anything else?
caller    No, that's it.
```

Validated result:

```json
{
  "consent_granted": true,
  "disposition": "Completed",
  "disposition_evidence": "caller said 'Oh, yes, thanks for calling back' and answered questions",
  "lead_intent": "Booking",
  "need_summary": "Chipped tooth, wants to be seen this week",
  "urgency": "Urgent",
  "callback_slot": "tomorrow at 9 if possible",
  "wants_booking": true,
  "notes": ""
}
```

Outcome `recovered`: full lead payload posted to the dashboard; `callback_slot` rendered as pending until a human confirms.

## Not Reached, Then Retry

Attempt 1 returns provider status `NO_ANSWER` with ring-out and no speech. Outcome `not-reached`: no lead fields posted, one retry scheduled 30 minutes out, attempt 2 of 2. The number is never suppressed — someone who did not answer has not refused anything.

If attempt 2 also returns `NO_ANSWER`, the cap is reached, the event is surfaced for manual handling, and no third call is placed.

## Declined and Do-Not-Call

```text
agent     Hi, this is Example Dental — we're sorry we missed your call earlier. Is now a good time?
caller    I already sorted it out, don't call me again.
```

`disposition: DoNotCall` with evidence `"don't call me again"`. Outcome `declined`: no lead fields posted, the event is closed, and the suppression propagates to the shared do-not-call record for all outbound workflows. Compare "bad time, try tomorrow" — that is `Declined`, which suppresses only this event's recovery.

## Blocked Before Dialing

```text
status: not called
blocker: timezone missing from event; working-hours check cannot run
supply: the caller's timezone, or schedule the recovery manually
```

Stopping is a successful outcome. Guessing is not.
