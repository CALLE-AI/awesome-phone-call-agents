# Canopy command reference

Run from `apps/typescript/canopy/`. `npm install` once. Every command is `node --import tsx src/cli.ts <command> [options]`;
`npm run canopy -- <command>` is equivalent.

| Command | Purpose | Calls placed |
| --- | --- | --- |
| `plan` | Score the registry, plan waves, print the rendered CALL-E task and schemas | never |
| `run` | Run a roll call for one event | dry-run: none; live: yes with `--confirm` |
| `serve` | Dashboard + webhook receiver; "Start drill" button in the browser | dry-run only |
| `watch` | Poll NWS or Open-Meteo and run when a playbook trigger matches | as `run` |
| `follow-up` | Redial yellow people whose follow-up is due | as `run` |
| `report` | Rebuild the after-action report from a ledger | never |
| `fake-server` | Run the fake CALL-E API in the foreground | never |

## Options

| Option | Meaning |
| --- | --- |
| `--registry <csv>` | Registry file (default `data/registry.sample.csv`) |
| `--hazard <id>` | `heat`, `flood`, `outage-medical`, `smoke`, `boil-water` |
| `--area <text>` | Area label used in the disclosure and report |
| `--headline <text>` | Alert headline (default: playbook title + area) |
| `--resource <text>` | Cooling centre / shelter / water point to mention |
| `--org <text>` | Overrides `CANOPY_ORG` for this run |
| `--emergency-number <text>` | Overrides `CANOPY_EMERGENCY_NUMBER` |
| `--wave-size <n>` | People per CALL-E call task |
| `--parallel <n>` | Waves in flight at once (default 1) |
| `--event-id <id>` | Stable event id (also used by `follow-up`, `report`, `serve`) |
| `--confirm` | Required in live mode |
| `--fast` | Collapse the redial delay (drills) |
| `--keep-server` | Keep the dashboard running after `run` finishes |
| `--nws-area <ST>` | `watch`: US state code for api.weather.gov |
| `--lat <n> --lng <n> --label <text>` | `watch`: Open-Meteo heat threshold at a point |
| `--interval <min>` | `watch`: polling interval (default 10) |
| `--now` | `follow-up`: ignore due times |
| `--quiet` | Suppress progress output |

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `CANOPY_MODE` | `dry-run` | `dry-run` or `live` |
| `CALLE_API_KEY` | unset | CALL-E Developer API key; live mode only |
| `CALLE_BASE_URL` | `https://api.heycall-e.com` | Override the API base in live mode |
| `CANOPY_PUBLIC_URL` | unset | Public HTTPS URL for webhook delivery in live mode; without it Canopy polls |
| `CANOPY_PORT` | `4700` | Dashboard and webhook receiver port |
| `CANOPY_FAKE_PORT` | `4747` | Fake CALL-E server port (dry-run) |
| `CANOPY_ORG` | `Canopy Emergency Response` | Organisation named in the disclosure |
| `CANOPY_EMERGENCY_NUMBER` | `your local emergency number` | Recited on red flags |
| `CANOPY_WAVE_SIZE` | `4` | People per call task |
| `CANOPY_LIVE_ALLOWLIST` | unset | Comma-separated E.164 numbers allowed in live mode |
| `CANOPY_DATA_DIR` | `data/runs` | Where ledgers and reports are written |

## Outputs

- `data/runs/<event-id>/ledger.jsonl`: append-only ledger, one JSON line per fact.
- `data/runs/<event-id>/after-action-report.md`: rebuilt by `report` at any time.
- Dashboard: `http://127.0.0.1:<CANOPY_PORT>/` with `/api/state`, `/api/stream` (SSE), `/api/report`.

## CALL-E surfaces used

`client.calls.create` with `recipients[]`, `recipientResultSchema`, `resultSchema`, `metadata`,
`webhookUrl` and an `Idempotency-Key`; `client.calls.get` and `client.calls.listEvents` for polling
and the live timeline; terminal webhooks (`call.completed`, `call.failed`,
`call.result_validation_failed`) received at `/calle/webhook`.
