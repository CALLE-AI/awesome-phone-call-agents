# Operations

## Running it

```bash
uv venv && uv pip install -e ".[dev]"
callibrate init          # create the database and the demonstration directory
callibrate serve         # http://localhost:8000
```

Sign in as `judge` / `callibrate-demo-2026`. The public directory is at `/find`
and needs no account.

## Configuration

Everything is `CBR_`-prefixed and read from the environment or `.env`. The
settings that change behaviour rather than plumbing:

| Setting | Default | What it does |
| --- | --- | --- |
| `CBR_CALLER_MODE` | `pilot` | `calle` places real phone calls. `pilot` replays scripts and dials nothing. |
| `CBR_CALL_ALLOWLIST` | empty | Comma-separated E.164 numbers this deployment may ring. Empty means none. |
| `CBR_DEMO_PROVIDER_PHONE` | empty | The number the seeded demonstration provider answers on. |
| `CBR_MINIMUM_CALL_INTERVAL_DAYS` | `1` | Days an organization is left alone after a call. Zero is refused in production. |
| `CBR_CALLE_ACCESS_TOKEN` | empty | An explicit bearer token. Left empty, the `calle` CLI token cache is read. |
| `CBR_CALLE_FIRST_POLL_SECONDS` | `60` | Delay before the first `get_call_run`, per CALL-E's guidance. |
| `CBR_CALLE_MAX_WAIT_SECONDS` | `900` | How long one process will follow a run. Reaching it fails the observation, not the call. |
| `CBR_ENVIRONMENT` | `development` | `production` refuses to start unsafely. See below. |

`CBR_ENVIRONMENT=production` will not start without: a unique secret key of at
least 32 characters, a changed curator password of at least 14, `CALLER_MODE=calle`,
a non-empty allowlist, spacing of at least one day, sample data off, HTTPS on, an
`https` public base URL, a named trusted proxy, and real hostnames in
`CBR_ALLOWED_HOSTS`.

## Connecting CALL-E

```bash
npm install -g @call-e/cli
callibrate calle login       # prints a URL; finish the authorization in a browser
callibrate calle status      # confirms the token and lists the three CALL-E tools
```

`calle login` uses CALL-E's login broker and writes the token to
`~/.calle-mcp/cli/<hash>/token.json`. Callibrate reads that cache. The token is
never logged, never passed to a model, and every error this code raises is run
through `redact()` before it can reach the ledger.

The console has the same flow under the CALL-E chip for an operator without
shell access.

## Recovering a call that lost its run id

`run_call` is asynchronous. Callibrate persists the `run_id` before it polls, so
a crash mid-call is recoverable rather than repeatable.

```bash
callibrate ledger --limit 50           # find the call.started event and its run id
calle call status --run-id run_xxx     # read the run without starting anything
```

If a `run_call` returned **no** `run_id`, the situation is documented as having
no general lookup. Do not create a new plan and do not retry. Use
`calle call recover` and escalate for operator review. A call may or may not have
been placed, and the only safe assumption is that it was.

Calls that were started and never finished:

```python
from callibrate.store import Store
Store("data/callibrate.db").open_call_runs()
```

## Checking the ledger

```bash
callibrate ledger --verify     # exit code 1 and the first broken sequence number
callibrate metrics             # call quality counted from rows
```

The console shows the same state as a chip in the command bar. A ledger that
does not verify is the loudest thing on the screen.

## Rebuilding the demonstration film

```bash
python tools/build_call_audio.py    # once: one clip per turn, two voices, telephone band
python demo_video/narrate.py        # narration read out of demo.js itself, plus timing.json
python demo_video/record.py         # record the walkthrough and mux the track
```

The script lives in `src/callibrate/web/demo.js` and the narration is generated
from it, so rewriting a caption re-times the film. `record.py` records offscreen
through Playwright by default. `--screen` captures the display instead, which is
sharper and will record anything else that is on it, so only use it on a machine
nobody is using.

## Backups

```python
Store("data/callibrate.db").backup_to("backups/callibrate-2026-09-10.db")
```

Uses SQLite's own online backup, so it is safe against a running server.
