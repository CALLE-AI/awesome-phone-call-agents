# No-Show Killer

Confirms tomorrow's appointments by phone with CALL-E, and lets the person reschedule
right there on the call, so a business finds out about a no-show the night before
instead of at the empty chair.

Source: <https://github.com/DavidUmunna/No-show-killer>

**Runs in dry-run mode by default.** No real call is placed until `DRY_RUN=false` is
set explicitly - see [Dry-run mode](#dry-run-mode-default-on).

## What it does

- `backend/` is a small Express API backed by a JSON file (`data/appointments.json`).
  It exposes appointments to the dashboard, and two ways to confirm one:
  a single click, or a nightly batch for everything scheduled tomorrow.
- `frontend/` is a static HTML/JS dashboard (no build step, no framework) that lists
  appointments, shows live call status over WebSocket, and lets a staff member trigger
  a confirmation call by hand.
- `backend/calle.js` is the entire CALL-E integration: it shells out to the `calle` CLI
  (installed as a regular npm dependency, already authenticated) to start a call and
  poll its status. No MCP server code needed - the CLI talks to CALL-E's hosted MCP
  server for you.

```text
no-show-killer/
├── backend/
│   ├── server.js          Express API, WebSocket broadcast, nightly cron
│   ├── calle.js            CALL-E integration + dry-run simulation
│   ├── phone-region.js      Best-effort region hint for startCall()
│   ├── scripts/smoke-test.mjs   Manual verification path (npm test)
│   └── data/appointments.json   Demo data (fictional NANP sample number)
└── frontend/
    ├── index.html · styles.css · app.js   The whole dashboard, no build step
```

## Setup

```bash
cd backend
npm install
npm start          # http://localhost:4000 by default, PORT in .env.example
```

Then open `frontend/index.html` directly in a browser (or `npx serve frontend`).
`frontend/app.js` has `API_BASE` as a literal constant at the top of the file - edit it
there to point at a deployed backend; there's no build step to inject it through.

Copy `backend/.env.example` to `backend/.env` and fill in `CALL_E_ACCESS_KEY` when
you're ready to go live (see below). Everything else has a safe default and the app
runs with an empty `.env`.

## Dry-run mode (default: on)

`DRY_RUN` defaults to `true`. While it's on, `backend/calle.js` never shells out to the
real `calle` CLI - `startCall()` and `callStatus()` return a synthetic response in the
same shape a real call produces (status `COMPLETED`, a fake `run_id`, a
`[DRY RUN]`-prefixed summary), so the rest of the app - status polling, the WebSocket
updates, the dashboard, `appointments.json` - exercises its real code paths without
spending a CALL-E credit or ringing anyone's phone. The backend logs
`[dry-run] would call <number> - goal: "..."` for every simulated call, and
`GET /api/health` reports the current `dryRun` value so the dashboard (or you, via
curl) can tell at a glance.

### Going live

1. Set `DRY_RUN=false` and a real `CALL_E_ACCESS_KEY` in `backend/.env`.
2. Put your own real phone number in one appointment in `data/appointments.json` and
   click "Send confirmation call" for that card, so the first real call is one you
   placed to yourself on purpose.
3. Check the backend terminal output / `data/appointments.json` afterward. The exact
   JSON field names read out of `calle call start`/`call status`
   (`run_id`, `status_result.structuredContent`, `result.structuredContent`) come from
   the CLI's documented shape; if status/activity fields don't populate, run
   `calle call start --to-phone <your number> --goal "test" --json` directly and
   adjust `extractFields`/`triggerCall` in `server.js` to match.

## Verifying it works

No external test framework - `npm test` (from `backend/`) runs `scripts/smoke-test.mjs`,
which fires a dry-run `startCall()`/`callStatus()` pair against a fictional NANP sample
number (`+12025550142`, reserved range, never a real subscriber) and asserts the fields
the rest of the app relies on come back in the right shape. It refuses to run at all
when `DRY_RUN=false`, so it can never place a real call:

```bash
cd backend && npm install && npm test
```

## Side effects

| Action | Effect |
| --- | --- |
| Clicking "Send confirmation call" (`DRY_RUN=false`) | **A real phone rings.** One CALL-E call is placed to that appointment's number. |
| The nightly batch firing (`DRY_RUN=false`) | Same, once per `PENDING` appointment scheduled for tomorrow. |
| Any confirmation call, real or simulated | The appointment's status/activity/summary fields in `data/appointments.json` are overwritten and broadcast to connected dashboards over WebSocket. |

There is no queue and no retry-on-failure: a triggered call either starts or it
doesn't, and `triggerCall()` refuses to start a second one for the same appointment
while one is already in flight.

## Stopping and rolling back

| To stop | Do this |
| --- | --- |
| All real calls, immediately | Set `DRY_RUN=true` (or unset it) and restart. No in-flight call is left orphaned, because nothing is queued beyond the one call already dialing. |
| The nightly cron | Set `CRON_ENABLED=false` and restart - the recurring job is skipped entirely, without touching code. The one-off `POST /api/confirm-tomorrow` and `POST /api/appointments/:id/confirm` endpoints keep working either way. Stopping the `npm start` process also stops it, since the schedule only runs while that process is alive. |
| A call that's already ringing | Not possible from this app or the `calle` CLI - there is no cancel/hangup command exposed. This is why `triggerCall()`'s in-flight guard (above) is the only protection against a duplicate dial. |

## Credential handling

`CALL_E_ACCESS_KEY` is read from the environment via `.env` (gitignored) and handed to
the `calle` CLI as a subprocess environment variable - it's never sent to the frontend,
logged, or written to `appointments.json`. `backend/.env.example` ships with every key
blank.

## Safety rules

| Requirement | How this app meets it |
| --- | --- |
| No real call without explicit opt-in | `DRY_RUN` defaults to `true`; going live requires deliberately setting it to `false` (see [Going live](#going-live)). |
| E.164 phone numbers | Appointments store `phone` in E.164; `phone-region.js` reads it to hint CALL-E's `region` parameter, it does not reformat or guess numbers. |
| Masking numbers in samples | `data/appointments.json`'s sample appointment uses `+12025550142`, in the reserved NANP `555-01xx` fictional range. |
| No credential exposure | See [Credential handling](#credential-handling) above. |
| No duplicate jobs | `triggerCall()` refuses a second call for an appointment whose existing call hasn't reached a terminal status. |
| No hidden recurring schedule | The nightly cron is documented in this README, logs its schedule at boot, and can be switched off with one env var (see [Stopping and rolling back](#stopping-and-rolling-back)). |
| Clear cancellation behavior | See [Stopping and rolling back](#stopping-and-rolling-back) above, including the one thing that genuinely can't be cancelled (a call already ringing). |
