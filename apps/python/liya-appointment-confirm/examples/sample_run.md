# Sample run

All phone numbers below are from the NANP fictional/reserved-for-media
range (`+1 202 555 01XX`) — not real numbers.

## 1. Dry run (actual captured output)

```
$ python confirm_call.py --task "Confirm the 10am appointment tomorrow" \
    --phone +12025550123 --region US --dry-run

=== Call preview ===
  Recipient : +********123
  Region    : US
  Task      : Confirm the 10am appointment tomorrow
  Result schema: confirmed (bool), reason, alternate_time_requested

Dry run only — no network request was made, no call was placed.
```

## 2. Placing a real call (illustrative — requires a real CALLE_API_KEY)

```
$ python confirm_call.py --task "Confirm the 10am appointment tomorrow" \
    --phone +12025550123 --region US

=== Call preview ===
  Recipient : +********123
  Region    : US
  Task      : Confirm the 10am appointment tomorrow
  Result schema: confirmed (bool), reason, alternate_time_requested

This will place a REAL phone call to +12025550123.
Type YES to proceed: YES
Call placed. call_id = call_example00000000000000
Waiting for the call to finish (this can take up to a few minutes)...
[CallE] call call_example00000000000000 -> in-progress
[CallE] call call_example00000000000000 -> completed

CALL-E call call_example00000000000000 to +12025550123: completed. The
recipient confirmed they can attend at 10am. Structured result:
{"confirmed": true, "reason": null, "alternate_time_requested": null}
```

## 3. A call that fails instantly (illustrative, based on a real failure
   pattern this app is designed to catch — carrier code and phone number
   substituted with fictional values)

```
$ python confirm_call.py --check call_example_failed000000

CALL-E call call_example_failed000000 to +12025550199: failed. Heads up:
that attempt to +12025550199 ended in under 0s with carrier failure code
404 — too fast for the phone to have even rung. That pattern almost
always means the number itself couldn't be reached at all (a typo'd
digit, disconnected, or not a real line), not that the recipient was busy
or unavailable. The first call did not connect or complete; the
recipient may be busy or unavailable, so I suggest retrying in about 45
minutes.
```

Note how the app's own diagnosis (first sentence) directly contradicts
CALL-E's generic canned summary (last sentence) — the near-zero duration
plus carrier code is the more reliable signal, and is exactly the pattern
that comes from a wrong or disconnected number rather than a busy line.

## 4. Duplicate-call guard

```
$ python confirm_call.py --task "Confirm the 10am appointment tomorrow" \
    --phone +12025550123 --region US --yes
Skipped: A call to this same number was already placed 42s ago (call id
call_example00000000000000). Re-run with --force if this is genuinely a
new, separate call.
```
