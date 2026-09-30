# Scheduling recurring check-ins

Shop check-ins are recurring, but **this skill places exactly one call per run**.
The host scheduler owns recurrence. CALL-E owns call execution. Nothing in this
project runs a daemon.

```text
host scheduler (cron / Task Scheduler)  ->  one morning or evening call  ->  ledger
```

Refs #20.

## What you are scheduling

Two jobs per shop, not one:

| Job | Local time | Call type | Captures |
| --- | --- | --- | --- |
| Morning check-in | ~07:15 | `inventory` | Stock levels, what is running low |
| Evening recap | ~19:30 | `sales` | Revenue, top sellers, restocking |

Pick times with the shop owner. A trader mid-sale will not thank you for a
four-minute call, and answer rate is the whole funnel.

## Before you schedule anything

1. **The owner has agreed to recurring calls**, not just one call. Recurring
   consent is a different question from one-off consent — ask it separately and
   record it in the shop profile.
2. **You have run the workflow in preview at least once** for that shop.
3. **The times are in the shop's IANA timezone**, taken from the shop profile —
   `Africa/Lagos`, `Asia/Kolkata`. Never infer a timezone from the phone number,
   the country code, or a UTC offset.

> **The scheduled command carries standing authorization.**
> The live flags (`--execute --confirm-recipient-opt-in`) sit inside the
> scheduler entry, which means consent stops being per-call and becomes
> standing. That is exactly why cancellation below must be as easy as creation.

## Generating the entries

Do not hand-write these. Path and timezone mistakes are the usual cause of a job
that silently never runs:

```bash
python3 skills/shop-voice-checkin/scripts/render_schedule.py \
  --profile apps/python/shop-voice-manager/fixtures/shop-profile.json \
  --app-dir /srv/voice-shop-manager \
  --platform cron
```

Use `--platform windows` for `schtasks` commands. Both print the exact lines to
install, verify, disable, and remove.

## cron — Linux

```cron
CRON_TZ=Africa/Lagos
15  7 * * * cd /srv/vsm && /srv/vsm/.venv/bin/python client.py --request /srv/vsm/shops/demo-lagos-corner-shop-inventory.json --execute --confirm-recipient-opt-in >> /srv/vsm/logs/checkin.log 2>&1 # ShopVoice-demo-lagos-corner-shop-inventory
30 19 * * * cd /srv/vsm && /srv/vsm/.venv/bin/python client.py --request /srv/vsm/shops/demo-lagos-corner-shop-sales.json --execute --confirm-recipient-opt-in >> /srv/vsm/logs/checkin.log 2>&1 # ShopVoice-demo-lagos-corner-shop-sales
```

Notes that matter:

- **The trailing `# ShopVoice-…` marker is load-bearing.** `/bin/sh` treats it as
  a comment, and it is the only thing that makes the verify and remove commands
  below able to find these lines. Without it, `crontab -l | grep` matches nothing
  and a "removal" silently removes nothing.
- Use **absolute paths** everywhere — interpreter, request file, log. cron does
  not load your shell profile, so a bare `python` is usually not on `PATH`.
- Redirect to a log. A cron job that fails silently is indistinguishable from one
  that never ran.

> **`CRON_TZ` has two sharp edges.**
> It applies to **every line after it** in the crontab, so put the ShopVoice
> block at the end or you will silently move unrelated jobs into the shop's
> timezone. And when you remove the jobs, remove the `CRON_TZ` line too.
>
> **`CRON_TZ` is a Linux extension.** macOS ships BSD cron, which ignores it and
> uses system local time. On macOS either write the times already converted to
> the machine's timezone, or use `launchd`, which handles this properly.

| Action | Command |
| --- | --- |
| Install | `crontab -e`, paste the block at the end |
| Verify | `crontab -l \| grep ShopVoice-{shop_id}` |
| Disable one job | `crontab -e`, prefix that line with `#` |
| Remove both | `crontab -l \| grep -v ShopVoice-{shop_id} \| crontab -` |
| Confirm it ran | `tail logs/checkin.log` |

## Windows Task Scheduler

```powershell
schtasks /Create /TN "ShopVoice-demo-lagos-inventory" /SC DAILY /ST 07:15 ^
  /TR "C:\voice-shop-manager\.venv\Scripts\python.exe C:\voice-shop-manager\client.py --request C:\voice-shop-manager\shops\demo-lagos-corner-shop-inventory.json --execute --confirm-recipient-opt-in"

schtasks /Create /TN "ShopVoice-demo-lagos-sales" /SC DAILY /ST 19:30 ^
  /TR "C:\voice-shop-manager\.venv\Scripts\python.exe C:\voice-shop-manager\client.py --request C:\voice-shop-manager\shops\demo-lagos-corner-shop-sales.json --execute --confirm-recipient-opt-in"
```

Task Scheduler uses the machine's local time and has no per-task timezone. If
the machine is not in the shop's timezone, convert the times yourself and write
the conversion into the task description so the next person understands it.

| Action | Command |
| --- | --- |
| Verify | `schtasks /Query /TN "ShopVoice-demo-lagos-inventory"` |
| Disable | `schtasks /Change /TN "ShopVoice-demo-lagos-inventory" /DISABLE` |
| Re-enable | `schtasks /Change /TN "ShopVoice-demo-lagos-inventory" /ENABLE` |
| Delete | `schtasks /Delete /TN "ShopVoice-demo-lagos-inventory" /F` |

## Updating without duplicating

Task names and cron lines are the identity of a schedule. Changing a time by
adding a second entry gives the shop owner **two calls a day instead of one**.

- cron: edit the existing line. Never append a second one for the same shop and
  call type.
- Windows: `schtasks /Change /TN "<name>" /ST 08:00`, not a second `/Create`.
- Always `crontab -l` or `schtasks /Query` afterwards and count the entries.

The naming convention makes duplicates visible:

```text
ShopVoice-{shop_id}-{inventory|sales}
```

## Cancellation

Cancellation is a first-class operation, not an afterthought. Three levels:

| You want to | Do this | Effect |
| --- | --- | --- |
| Skip today only | Nothing — or delete the day's request file | The run fails safely and logs; nothing is written |
| Pause the shop | Disable both scheduler entries | Calls stop, ledger and history are kept |
| Stop permanently | Delete both entries **and** clear `recipient_consented` in the shop profile | Calls stop and cannot be restarted by accident |

**If an owner asks to stop during a call** — see
`fixtures/edge-cases/consent-refused.json` — removing the scheduler entries is
the action that actually stops the calls. Updating the profile alone does not,
because the scheduler does not read consent. Do both, in that order.

## Missed runs

If the machine was asleep or offline, the run is simply skipped. Do not
back-fill.

- A morning inventory question is meaningless at 3pm.
- Idempotency keys are `shopvoice-{shop_id}-{type}-{YYYY-MM-DD}`, so a
  same-day retry cannot become a second real call.
- The weekly summary already tolerates gaps; a missing day lowers
  `days_with_data` and nothing breaks.

If you add a catch-up wrapper later, give it a **late-run window** — skip the
call if it is more than about 60 minutes late — so a laptop opened at midnight
does not ring a shop owner. `call-reminder` uses 30 minutes for the same reason.

## Scaling past one shop

One entry pair per shop stops being sensible somewhere around a dozen shops. At
that point schedule a single batch job that iterates the shops due for a call,
and keep the same rules: one call per shop per type per day, idempotency keys
unchanged, and one cancellation switch per shop rather than one global one.

## Related

- [`safety.md`](./safety.md) — consent and side-effect boundaries
- [`call-reminder`](../../call-reminder/) — the general scheduler-wrapper skill
- `apps/python/shop-voice-manager/SCHEMA.md` — what each run writes to the ledger
