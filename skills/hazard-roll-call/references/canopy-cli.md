# Canopy command reference

Run from `apps/typescript/canopy/`. `npm install` once. Every command is `node --import tsx src/cli.ts <command> [options]`;
`npm run canopy -- <command>` is equivalent.

| Command | Purpose | Calls placed |
| --- | --- | --- |
| `plan` | Score the registry, plan waves, print the rendered CALL-E task and schemas | never |
| `run` | Run a roll call for one event | dry-run: none; live: yes with `--confirm` |
| `resume` | Reattach to an interrupted event: settle pending calls, re-place refused waves, finish the cascade | as `run` |
| `serve` | Dashboard + webhook receiver; "Start drill" button in the browser | dry-run only |
| `watch` | Poll NWS, Open-Meteo or Singapore NEA PSI and run when a playbook trigger matches | as `run` |
| `follow-up` | Redial yellow people whose follow-up is due | as `run` |
| `report` | Rebuild the after-action report from a ledger | never |
| `fake-server` | Run the fake CALL-E API in the foreground | never |

## Options

| Option | Meaning |
| --- | --- |
| `--registry <csv>` | Registry file (default `data/registry.sample.csv`; `data/registry.sample.ahmedabad.csv` also ships) |
| `--hazard <id>` | `heat`, `flood`, `outage-medical`, `smoke`, `boil-water` |
| `--area <text>` | Area label used in the disclosure and report |
| `--headline <text>` | Alert headline (default: hazard noun + area) |
| `--resource <text>` | Cooling centre / shelter / water point to mention |
| `--org <text>` | Overrides `CANOPY_ORG` for this run |
| `--emergency-number <text>` | Overrides `CANOPY_EMERGENCY_NUMBER` |
| `--wave-size <n>` | People per wave |
| `--parallel <n>` | Waves in flight at once (default 1) |
| `--batch` / `--per-person` | One task per wave, or one task per person (live default: per-person) |
| `--event-id <id>` | Stable event id (also used by `resume`, `follow-up`, `report`, `serve`) |
| `--confirm` | Required in live mode |
| `--override-quiet-hours "<reason>"` | Start a life-safety roll call inside quiet hours; the reason is written to the ledger |
| `--fast` | Collapse the redial delay (drills) |
| `--keep-server` | Keep the dashboard running after `run` finishes |
| `--nws-area <ST>` | `watch`: US state code for api.weather.gov |
| `--lat <n> --lng <n> --label <text>` | `watch`: Open-Meteo heat threshold at a point |
| `--nea-psi` | `watch`: Singapore NEA 24-hour PSI (smoke playbook) |
| `--interval <min>` | `watch`: polling interval (default 10) |
| `--now` | `follow-up`: ignore due times |
| `--quiet` | Suppress progress output |

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `CANOPY_MODE` | `dry-run` | `dry-run` or `live` |
| `CALLE_API_KEY` | unset | CALL-E Developer API key; live mode only |
| `CALLE_BASE_URL` | `https://api.heycall-e.com` | Override the API base in live mode |
| `CANOPY_PUBLIC_URL` | unset | Public HTTPS URL for webhook delivery in live mode; without it Canopy polls. Setting it turns on the dashboard token |
| `CANOPY_DASHBOARD_TOKEN` | auto when a public URL is set | Token required on every route except `/calle/webhook` |
| `CANOPY_HOST` | `127.0.0.1` | Bind address; `0.0.0.0` only for a hosted dry-run demo |
| `CANOPY_PORT` (or `PORT`) | `4700` | Dashboard and webhook receiver port |
| `CANOPY_FAKE_PORT` | `4747` | Fake CALL-E server port (dry-run) |
| `CANOPY_ORG` | `Canopy Emergency Response` | Organisation named in the disclosure |
| `CANOPY_EMERGENCY_NUMBER` | `your local emergency number` | Recited on red flags |
| `CANOPY_WAVE_SIZE` | `4` | People per wave |
| `CANOPY_TASK_MODE` | live: `per-person`; dry-run: `batch` | How waves become CALL-E tasks |
| `CANOPY_QUIET_HOURS` | `21:00-07:00` | Calling window; `none` disables |
| `CANOPY_TIMEZONE` | system zone | IANA zone the quiet window is evaluated in |
| `CANOPY_LIVE_ALLOWLIST` | unset | Comma-separated E.164 numbers allowed in live mode |
| `CANOPY_DATA_DIR` | `data/runs` | Where ledgers and reports are written |

## Outputs

- `data/runs/<event-id>/ledger.jsonl`: append-only ledger, one JSON line per fact.
- `data/runs/<event-id>/after-action-report.md`: rebuilt by `report` at any time; marked incomplete while calls are pending or waves were refused.
- Dashboard: `http://127.0.0.1:<CANOPY_PORT>/` with `/api/state`, `/api/stream` (SSE), `/api/report`, `/api/events`, `/api/registries`.

## Person states

`green`, `yellow`, `red`, `unreachable`, `unverified` are verdicts from a completed call. `declined` means a person
answered and asked to be called later: a follow-up is scheduled and no contact is alerted. `not_attempted` means CALL-E never
accepted the task (nobody was dialled, nobody is alerted; resume the event). `awaiting` means the call is accepted but not
finished (resume settles it).

## CALL-E surfaces used

`client.calls.create` with `recipients[]`, `recipientResultSchema`, `resultSchema`, `metadata`, `webhookUrl` and an
`Idempotency-Key` (retried with backoff on 429/5xx); `client.calls.get` and `client.calls.listEvents` for polling and the live
timeline; terminal webhooks (`call.completed`, `call.failed`, `call.result_validation_failed`) received at `/calle/webhook`.
