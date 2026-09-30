# CLI reference

All commands run from `apps/typescript/still-covered`.

```bash
npm install
npm run sc -- <command> [options]
```

Shortcuts: `npm run plan`, `npm run demo`, `npm run serve`, `npm run fake-server`, `npm test`,
`npm run check`.

CALL-E's own CLI parameters and command flags are documented in
[`cli-reference.md`](https://github.com/CALLE-AI/call-e-integrations/blob/main/packages/cli/docs/cli-reference.md).

## Commands

### `plan` - decide before you dial

```bash
npm run sc -- plan --registry data/enrollees.sample.csv --as-of 2026-09-14
```

Loads the list, prints who the state's data already clears, plans the waves in risk order, prints
each person's question count, and prints the fully rendered CALL-E task for the first person.
**Places no call and needs no configuration.** Run this first, always, and read the task text.

### `run` - the campaign

```bash
npm run sc -- run --registry data/enrollees.sample.csv --fast          # dry-run
npm run sc -- run --registry data/enrollees.private.csv --confirm      # live (needs SC_MODE=live + key)
```

Clears by data, dials the rest in waves, waits webhook-first / polling-always, classifies
fail-closed, redials whoever was not screened, and writes the worklist and the report. In dry-run it
starts the fake CALL-E server automatically if one is not already listening.

### `resume` - recover an interrupted campaign

```bash
npm run sc -- resume --campaign-id example-state-2026-09-14-202609112351
```

Settles calls that were still in flight, re-places refused tasks **with their original idempotency
keys**, and finishes the worklist. Safe to run repeatedly: on a finished campaign it places no call
and creates no duplicate work. This is the recovery path - never re-run `run`.

### `follow-up` - call back the people who asked for a better time

```bash
npm run sc -- follow-up --campaign-id <id>          # only those now due
npm run sc -- follow-up --campaign-id <id> --now    # ignore due times (drills)
```

Respects the three-call cap and the opt-out list: people past the cap get a letter instead, and
people who opted out are never dialled.

### `serve` - dashboard and webhook receiver

```bash
npm run serve                     # http://127.0.0.1:4800
```

Live state over SSE, the worklist with a review action (`POST /api/work/:id/review`), and the
webhook endpoint at `/calle/webhook`. Drills can be started from the browser **in dry-run only** -
`POST /api/run` returns 403 in live mode. Setting `SC_PUBLIC_URL` auto-generates a dashboard token
that every route except the webhook requires.

### `report` - rebuild the Markdown report

```bash
npm run sc -- report --campaign-id <id>
```

Regenerates `data/runs/<id>/outreach-report.md` from the ledger alone. Deterministic: the same
ledger always produces the same bytes.

### `fake-server` - the local CALL-E stand-in

```bash
npm run fake-server               # http://127.0.0.1:4848
```

Implements `calls.create`, `calls.get`, `calls.listEvents`, idempotency replay, webhook delivery, and
thirteen behavioural scenarios keyed off the registry's `scenario` column. It can also inject
failures (rate limits, outages, invalid requests) - that is how the robustness suite works.

## Options

| Option | Meaning |
| --- | --- |
| `--registry <csv>` | Enrollee list. Default `data/enrollees.sample.csv`. Real lists must end in `.private.csv`. |
| `--state <id>` | Which file in `states/`. Default from `SC_STATE`, else `example-state`. |
| `--rules <json>` | Rules file. Default `rules/federal-2027.json`. |
| `--campaign-id <id>` | Stable id. Required by `resume`, `follow-up` and `report`. |
| `--title <text>` | Campaign title shown on the dashboard and in the report. |
| `--as-of <YYYY-MM-DD>` | Date used for deadline arithmetic. Default: today in `SC_TIMEZONE`. |
| `--due-within <days>` | Only include people whose coverage check is within this many days. |
| `--wave-size <n>` | People per wave. Default from `SC_WAVE_SIZE` (4). |
| `--parallel <n>` | Waves in flight at once. Default 1. |
| `--confirm` | Required for live mode. Without it, live refuses to start. |
| `--fast` | Collapse redial delays. Drills only. |
| `--keep-server` | Keep the dashboard running after `run` finishes. |
| `--now` | `follow-up`: ignore due times. |

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `SC_MODE` | `dry-run` | `live` is one of three signals required to dial a real number. |
| `CALLE_API_KEY` | none | Required in live mode. Lives only in the git-ignored `.env`. |
| `SC_LIVE_ALLOWLIST` | none | Comma-separated E.164. In live mode nobody else is dialled. |
| `SC_STATE` | `example-state` | State configuration to load. |
| `SC_TIMEZONE` | system | Quiet hours and deadline arithmetic. |
| `SC_QUIET_HOURS` | `21:00-08:00` | Enforced in live mode with no override. |
| `SC_MAX_ATTEMPTS` | `2` | Calls per person per campaign. Above 3 is rejected at load. |
| `SC_WAVE_SIZE` | `4` | People per wave. |
| `SC_PORT` | `4800` | Dashboard port. |
| `SC_FAKE_PORT` | `4848` | Fake CALL-E server port. |
| `SC_PUBLIC_URL` | none | Tunnel URL for webhooks; setting it auto-generates a dashboard token. |
| `SC_DASHBOARD_TOKEN` | auto | Token required on every dashboard route except the webhook. |
| `SC_DATA_DIR` | `data/runs` | Where ledgers and reports are written. |

Copy `.env.example` to `.env` and edit. `.env` is git-ignored; never commit a key.

## Live-mode checklist

1. Confirm the list is real, authorized and consented.
2. `SC_LIVE_ALLOWLIST` set to the rehearsal numbers.
3. `SC_TIMEZONE` set to the enrollees' time zone, not yours.
4. Registry file named `*.private.csv`.
5. Read `references/safety.md`.
6. Run `plan` and read the rendered task aloud.
7. Then, and only then, `run ... --confirm`.
