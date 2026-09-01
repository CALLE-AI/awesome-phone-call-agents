# table-rescue

Cascade coordinator that recovers cancelled restaurant tables with CALL-E phone calls.
It confirms reservations before service, and when a guest cancels, it offers the freed
table to waitlist guests in priority order until someone accepts.

Dry-run is the default. Live calls require an explicit `--live` flag and always run
inside a call budget.

## How it works

1. Confirm phase: call each `PENDING_CONFIRM` reservation; the agent ends every call by
   stating an `OUTCOME:` token (CONFIRMED, CANCELLED, RESCHEDULED, NO_ANSWER).
2. Cascade phase: for each cancelled slot, call matching waitlist entries (consent,
   WAITING status, party size within tolerance, slot inside their window) in priority
   order until one ACCEPTED. The slot is marked RECOVERED.
3. Writeback: reservations and waitlist files are rewritten atomically, every decision
   is appended to the run audit log, and a masked staff report is written.

## Safety model

- Dry-run by default: outcomes come from `data/fixtures/dry_run_outcomes.jsonl`; no
  network access.
- Live calls need `--live` plus a `--max-calls` budget (default 10). The engine stops
  before dialing once the budget is exhausted.
- Consent: records with `consent: false` are never dialled (audited as
  SKIPPED_NO_CONSENT).
- Idempotency: reruns with the same `--run-id` skip already-dialled targets
  (SKIPPED_DUPLICATE).
- Cancel: `table-rescue cancel --run-id <id>` marks the run cancelled; later
  invocations with the same run id refuse to dial.
- Call window: live calls are refused outside `--call-window-start/end`
  (default 09:00-21:00 local).
- All sample phone numbers are fictional reserved numbers; reports mask numbers to the
  last two digits.

## Setup

Requires Python 3.10+. The CALL-E CLI is only needed for live calls.

```bash
cd apps/python/table-rescue
python -m venv .venv
source .venv/Scripts/activate   # Windows Git Bash; use .venv/bin/activate on POSIX
pip install -e ".[dev]"
```

For live calls, install and log in to the CALL-E CLI (npm package `@call-e/cli`):

```bash
npm install -g @call-e/cli
calle auth login --base-url https://seleven-mcp-sg.airudder.com --channel openagent_oauth
```

## Usage

Dry-run (no calls):

```bash
cp data/reservations.sample.jsonl data/reservations.jsonl
cp data/waitlist.sample.jsonl data/waitlist.jsonl
table-rescue run --run-id smoke-1
```

Live (real calls through CALL-E MCP Streamable HTTP using the CALL-E CLI token cache):

```bash
table-rescue run --run-id live-1 --live --max-calls 6
```

Cancel a run:

```bash
table-rescue cancel --run-id live-1
```

## Side effects

- Live mode places real outbound phone calls through CALL-E and consumes call credit.
- Live mode reads the CALL-E CLI token cache (`~/.calle-mcp/cli`); the app never stores
  credentials.
- The app rewrites `data/reservations.jsonl` and `data/waitlist.jsonl` in place and
  writes `state/runs/<run-id>/audit.jsonl` plus `state/runs/<run-id>/report.md`.

## Credential handling

Access tokens are read from the CALL-E CLI token cache at call time, held in memory
only, and never written to app state or logs.

## Tests

```bash
python -m pytest
```

The default suite is a dry-run/fake path: no CALL-E credentials, no network, no real
calls. Live verification is opt-in: run one small `--live --max-calls 1` run against a
phone you control.

## Limitations

- Cascade runs only for reservations cancelled during the same run.
- One retry per no-answer target (`--no-answer-retries`).
