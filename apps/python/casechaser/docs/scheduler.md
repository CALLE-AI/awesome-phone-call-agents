# Host scheduler recipe

CaseChaser owns the decision to call; the host owns recurrence. One cycle per case, twice a day,
is enough: the suppression reasons decide whether a call happens.

## The scheduled-run authorization record

A scheduled run never carries `--yes`. It carries a file the operator wrote deliberately, per case,
that names the exact destination, an expiry date, a call budget, and permission for unattended runs:

```bash
python3 -m casechaser --data ./data authorize <case_id> --hotline +12125550100 --until 2026-10-31 --max-calls 6 --unattended
# -> ./data/authorizations/<case_id>.json
```

The live run refuses unless the record exists, belongs to this case, names the case hotline
character for character, has not expired, has budget left, and says `unattended: true`. Each placed
call decrements the budget in the record. Delete the record to stop scheduled calls for that case.

## cron (Linux, macOS)

```cron
# twice each weekday, mid-morning and mid-afternoon in the server's local time
15 10,15 * * 1-5  cd /path/to/casechaser && for a in data/authorizations/*.json; do c=$(basename "$a" .json); python3 -m casechaser --data ./data run "$c" --mode live --authorization "$a" >> chase.log 2>&1; done
```

Only cases with an authorization record are visited. Business-hours checks use each case's own
time zone, so a server in one zone chasing companies in another is fine.

## launchd (macOS)

Use a `StartCalendarInterval` plist that runs the same loop; keep `--authorization` explicit.

## Ambiguity stops the schedule

- If a run dies after the request was accepted, the case holds with `pending_reconciliation` and
  no scheduled run will dial it. Run `python3 -m casechaser --data ./data reconcile <case_id>`
  (fetches the recorded call id) or `--call-id <id>` from the CALL-E dashboard, or `--clear` after
  you have confirmed no call exists.
- A result the app cannot validate, or an `unknown` outcome, puts the case in `needs_human`. It
  stays there until you `decide`.

## Cancellation

- Stop one case: delete `data/authorizations/<case_id>.json`, or
  `python3 -m casechaser --data ./data decide <case_id> "stop" --close abandon`
- Stop everything: remove the cron line. A call already placed completes at CALL-E; reconcile it
  on the next manual run.
