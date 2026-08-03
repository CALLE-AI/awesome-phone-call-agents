# Examples

All phone numbers below are reserved fictional numbers.

## Waitlist Backfill (appointment business)

User request:

> Chloe just cancelled her 11am check-up tomorrow. Call the waitlist and fill it.

Waterfall input:

```json
{
  "opening": "Check-up, Sunday August 2 at 11:00 AM, Riverside Dental Clinic",
  "candidates": [
    { "name": "Elena Petrova", "phone": "+15550101001", "priority": 1 },
    { "name": "Farid Rahman", "phone": "+15550101002", "priority": 2 },
    { "name": "Grace Liu", "phone": "+15550101003", "priority": 3 }
  ]
}
```

Run: Elena declines ("not available"), Farid's phone goes to voicemail (decline),
Grace accepts. Report:

```text
Opening: Check-up, Sun Aug 2, 11:00 AM — FILLED by Grace Liu

  #1 Elena Petrova  +15*****01  completed  accepted: no  (not available at that time)
  #2 Farid Rahman   +15*****02  completed  accepted: no  (voicemail — message left)
  #3 Grace Liu      +15*****03  completed  accepted: yes

Not called: none (acceptance on final candidate).
```

## Shift Coverage (with cap and deadline)

User request:

> Sam called in sick for tonight's 6pm–close shift. Call the part-timers in seniority
> order, but stop by 4pm either way, and don't call more than 4 people.

Waterfall input adds `"maxCalls": 4` and `"deadline": "2026-08-02T16:00:00-04:00"`.
If nobody accepts by the deadline, the report ends with:

```text
Outcome: UNFILLED — deadline reached after 3 of 4 permitted calls.
Not called: Dana Wu (#4), Omar Haddad (#5).
Re-run with the remaining candidates if the shift is still open.
```

## On-Call Escalation

User request:

> Sev-2 on the payments API. Walk the on-call chain until someone acknowledges.

The "opening" is the incident acknowledgment; `accepted: yes` means the callee took
ownership. The goal states the incident id and severity, asks for a clear "I'm on
it", and treats voicemail as a decline so the chain keeps escalating. This is a
notification chain — never a substitute for emergency services.
