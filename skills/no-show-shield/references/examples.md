# Examples

All examples use the fictional demo calendar shipped with the reference
implementation. No example places a call to a real person.

## 1. Preview a day (no calls placed)

```bash
python3 -m noshow_shield sync data/demo-schedule.json
python3 -m noshow_shield preview --date 2026-09-12
```

```text
Would call for 2026-09-12:
  08:00  Priya Raman        Hot water inspection   +61491570156
  09:30  Dean Whitford      Blocked drain          +61491570157
```

## 2. Offline run against the mock provider

The mock provider returns deterministic outcomes per booking, so the whole
pipeline — including calendar write-back and the summary — can be exercised
with no credentials and no spend.

```bash
python3 -m noshow_shield run --date 2026-09-12
```

## 3. Live run, every call routed to your own handset

```bash
export CALLE_API_KEY="..."
python3 -m noshow_shield run --date 2026-09-12 --live --override-phone +61400000000
```

`--live` refuses to start without `--override-phone`, so a demonstration
cannot dial a booking's stored number.

## 4. What comes back

A reschedule captured from a real call, as written to the calendar:

```json
{
  "confirmation_status": "reschedule_requested",
  "reschedule_preference": "Thursday afternoon at 3:00 PM",
  "notes": "Customer asked to move the blocked drain appointment and was told the business will follow up by text to lock it in."
}
```

## 5. The operator summary

```text
Shorewood Plumbing (demo) — confirmation run for 2026-09-12
----------------------------------------------
08:00  Priya Raman        Hot water inspection   -> confirmed
09:30  Dean Whitford      Blocked drain          -> reschedule_requested
                          (wants: Thursday afternoon at 3:00 PM)
----------------------------------------------
Totals: confirmed=1, reschedule_requested=1
Needs you: Dean Whitford
```

The `Needs you:` line is the point of the skill: one glance, and the operator
knows the only booking that still costs them time.

## Notes from live use

- The first call of a session has been observed to take several minutes
  between `create` and the phone ringing; subsequent calls connect faster.
  Budget wall-clock time accordingly when demonstrating.
- Times are rendered into natural speech ("tomorrow at 9:30 in the morning")
  before they reach the model. Passing ISO dates through causes the agent to
  read them out digit by digit.
