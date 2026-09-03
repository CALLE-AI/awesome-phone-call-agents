# Blood Bank Dispatch

Parallel blood-stock enquiry for CALL-E. Files one request — blood group, rhesus, units needed — then dials every blood bank at the same time, asks a fixed set of stock questions, and returns a ranked shortlist of who has the units and how fast they can reach the patient. A serial 20-minute manual calling loop becomes a parallel 90-second one.

This is a runnable demo app, not a CALL-E SDK.

> **Decision support only.** The agent gathers and reports. It never makes a clinical decision, never reserves, never dispatches, and never promises anything on anyone's behalf. A qualified human reads the shortlist and acts.

> **No calls by default.** The app ships in `DRY_RUN=1`: the full pipeline runs against simulated results — four scripted personas covering stock, alternatives, uncertainty, a callback request, and a no-answer — with no credentials and no spend. Set `DRY_RUN=0` to place real CALL-E calls. Demo targets should be mock lines; obtain consent before pointing this at any real facility.

## What it does

1. Operator keeps a registry of blood banks (name, E.164 phone, area, notes).
2. Operator files a request: group, rhesus, units, which banks to call, plus optional ad hoc numbers.
3. Every target is inserted into `call_results` as `queued` **before** any call is placed — the UI shows all cards immediately.
4. The backend fans out one CALL-E call per target (`asyncio.gather` + semaphore), asking an ordered set of questions: units available, screening and cross-match status, release policy, cost per unit, transport time, contact person, alternatives.
5. Answers are extracted into a strict JSON schema — `unknown` enum members preserve hedged answers as real information instead of false numbers — and persisted alongside the raw CALL-E response and transcript.
6. The results page polls every two seconds; cards transition `queued → dialing → terminal`, and a shortlist ranks completed results by units available, then time to bedside.

## Setup

Python 3.12+ and a Postgres database.

```bash
cd apps/python/blood-bank-dispatch
python3 -m venv venv
venv/bin/pip install fastapi "uvicorn[standard]" jinja2 asyncpg python-multipart python-dotenv calle-ai

cp .env.example .env    # fill in DATABASE_URL; CALLE_API_KEY only for live calls

python3 migrate.py      # applies migrations/*.sql
python3 seed.py         # four fictional demo banks (+1555010xxxx)

venv/bin/python -m uvicorn app.main:app --port 8000
```

Open `http://localhost:8000` → New request. With the default `DRY_RUN=1`, filing a request runs the entire pipeline — fan-out, extraction, persistence, UI — against simulated results.

A real run costs one paid CALL-E call per target. Test with single-target runs while building; save full fan-outs for integration checks and recording.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DRY_RUN` | no | `1` | `1` = no-call mode, no `CALLE_API_KEY` needed. `0` = place real CALL-E calls. |
| `CALLE_API_KEY` | for live runs | — | CALL-E API key. Server side only; the browser gets htmx and HTML fragments, nothing else. |
| `CALLE_BASE_URL` | no | `https://api.heycall-e.com` | Test env: `https://test-api.heycall-e.com`. |
| `DATABASE_URL` | yes | — | asyncpg Postgres DSN. |
| `CALLE_CONCURRENCY` | no | `2` | Max simultaneous calls per run. Confirm your account concurrency cap before raising. |
| `MAX_TARGETS` | no | `8` | Server-side cap on targets per run (each target is a paid call). |
| `RATE_LIMIT_RUNS` | no | `6` | `POST /runs` per client IP per 10 minutes. |
| `CALLE_CALL_TIMEOUT` | no | `600` | Seconds to wait for one call to reach a terminal state. |

## Side effects

- With `DRY_RUN=0`, filing a request places **real outbound phone calls** — one per target, concurrent up to `CALLE_CONCURRENCY`.
- There are no recurring jobs, no schedules, and no background work beyond the run itself. Every run is a visible page of cards; the run ends when all targets reach a terminal state.

## Cancellation and recovery

- A run cannot be cancelled mid-call from the UI; it is bounded by `MAX_TARGETS`, the per-call timeout (`CALLE_CALL_TIMEOUT`), and the per-call budget.
- If the process dies mid-run, rows stay visibly stuck rather than silently disappearing. `scripts/recover_stuck_call.py` re-drives a row stuck in `dialing` by replaying its persisted idempotency key — the CALL-E API deduplicates, so exactly one call task ever exists.

## Reliability design

- **Queued-first inserts.** Every target row exists before dialing; a crash leaves a visible row, never a silent gap.
- **Idempotency keys persisted before the request** (`run:{id}:bank:{key}:v1`, sent as an `Idempotency-Key` header); network retries are safe.
- **Create and wait are split.** The call id is persisted the moment it exists; polling tolerates transient connection errors.
- **Bounded fan out.** Semaphore caps concurrency; `MAX_TARGETS` and a rate limit bound cost.
- **Raw evidence retained.** `structured_raw` (unmodified CALL-E response) and the transcript are stored beside every parsed column, so a wrong extraction can always be audited.

## Swapping in real blood banks

Deactivate the demo banks and add real ones in the registry — nothing else changes. Before you do:

1. Obtain consent from each facility to be called by an automated agent, and say who is calling on the call itself.
2. Confirm your CALL-E account's concurrency cap and set `CALLE_CONCURRENCY` under it.
3. Keep `MAX_TARGETS` and `RATE_LIMIT_RUNS` in place — a bug that dials real clinical lines in a loop is the worst failure mode this project has.

## Safety notes

- **Explicit intent** — calls are placed only when the operator files a request naming the targets.
- **E.164 only** — validated on write, unique in the registry; samples use reserved fictional numbers (`+1555010...`).
- **No credential exposure** — keys live in `.env`, read server side only.
- **No patient data** — no names are collected or stored; the schema has an opaque internal reference only.
- **Medical boundary** — this is a logistics tool for stock questions. It gives no diagnosis, dosage, treatment, or emergency guidance. For emergencies, contact local emergency services.

## Project structure

```text
app/
  main.py        # FastAPI routes: registry CRUD, POST /runs, polled cards fragment
  dispatch.py    # CallTarget fan-out, semaphore, dry-run personas, result persistence
  prompt.py      # CALL-E task prompt + extraction schema
  db.py          # asyncpg pool (small, warm; jsonb codecs)
  templates/     # Jinja2 + htmx (vendored in static/)
migrations/      # plain SQL, reviewer-readable
scripts/
  run_status.py          # show the latest (or a given) run and its results
  recover_stuck_call.py  # re-drive a row stuck in 'dialing' via idempotent replay
seed.py          # four fictional demo banks
```

## License

MIT, same as this repository.
