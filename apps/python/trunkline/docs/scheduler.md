# Running Trunkline from a host scheduler

Trunkline has no scheduler. The host owns recurrence; Trunkline places at most one call per bundle per run. That keeps the app portable across providers and means there is never a provider-side recurring job to discover later.

```text
Host scheduler handles recurrence.
CALL-E handles exactly one call per bundle per scheduled run.
```

## Before scheduling anything

A scheduled run cannot answer a prompt, so its permission has to exist in writing beforehand:

```bash
python3 -m trunkline --data /srv/trunkline/data authorize \
  --payer pay_meridian --phone +12125550142 \
  --until 2026-10-31 --max-calls 40 --note "denial backlog"
```

The record expires on its own and runs out of calls on its own. A scheduled run never carries `--yes`.

## A daily cycle

```cron
# Weekdays at 09:15 local. The calling window and every other hold still apply.
15 9 * * 1-5 cd /srv/trunkline && /usr/bin/python3 -m trunkline --data ./data run --mode live --limit 5 >> /var/log/trunkline.log 2>&1
```

Nothing in that line approves a call. It offers Trunkline the chance to make one, and thirteen named holds decide whether it does: the calling window in the payer's own timezone, the hold budget, the per-run call cap, the cost cap, the filing deadline, an unreconciled earlier call, a missing vault record, the kill switch, and the four authorization checks.

Read them before scheduling, with no call placed:

```bash
python3 -m trunkline --data ./data status --mode live
```

## Reconciling

A run that dies after CALL-E accepted a call leaves its claims in `pending_reconciliation`. Nothing redials them. Add a second, cheaper entry to resolve those:

```cron
*/20 * * * * cd /srv/trunkline && /usr/bin/python3 -m trunkline --data ./data reconcile >> /var/log/trunkline.log 2>&1
```

If CALL-E has no record of the call, confirm in the dashboard and then clear it:

```bash
python3 -m trunkline --data ./data reconcile --call <call_id> --clear
```

## Stopping

| To stop | Do this | Effect |
| --- | --- | --- |
| Everything, immediately | `trunkline kill-switch on` | Every call is refused while the file exists |
| One payer | `trunkline revoke --payer <id>` | Live runs against it refuse |
| Future cycles | Remove the cron entry | No new runs |
| A call in flight | Nothing to do | It completes at CALL-E; `reconcile` folds it in |

## Review is not scheduled

An answered claim waits for a person. Nothing exports, writes back, or closes on a timer. Run the console when someone is ready to review:

```bash
python3 -m trunkline --data ./data console
```
