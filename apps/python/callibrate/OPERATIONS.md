# Operations

## Running it

```bash
uv venv && uv pip install -e ".[dev]"
callibrate init          # create the database and the demonstration directory
callibrate serve         # http://localhost:8000
```

Sign in as `judge` / `callibrate-demo-2026`. The public directory is at `/find`
and needs no account. Whether a visitor there may start a phone call is the
deployment's decision; see *Who may ask for a call* below.

## Configuration

Everything is `CBR_`-prefixed and read from the environment or `.env`. The
settings that change behaviour rather than plumbing:

| Setting | Default | What it does |
| --- | --- | --- |
| `CBR_CALLER_MODE` | `pilot` | `calle` places real phone calls. `pilot` replays scripts and dials nothing. |
| `CBR_CALL_ALLOWLIST` | empty | Comma-separated E.164 numbers this deployment may ring. Empty means none. |
| `CBR_DEMO_PROVIDER_PHONE` | empty | The number the seeded demonstration provider answers on. |
| `CBR_MINIMUM_CALL_INTERVAL_DAYS` | `1` | Days an organization is left alone after a call. Zero is refused in production. |
| `CBR_ALLOW_PUBLIC_VERIFICATION` | unset | Whether a visitor with no account may start a verification. Unset: open on the pilot line, closed once the deployment can dial. |
| `CBR_PUBLIC_VERIFICATION_DAILY_LIMIT` | `25` | Verifications anonymous visitors may cause in one UTC day, deployment-wide. |
| `CBR_CALLE_ACCESS_TOKEN` | empty | An explicit bearer token. Left empty, the `calle` CLI token cache is read. |
| `CBR_CALLE_FIRST_POLL_SECONDS` | `60` | Delay before the first `get_call_run`, per CALL-E's guidance. |
| `CBR_CALLE_MAX_WAIT_SECONDS` | `900` | How long one process will follow a run. Reaching it fails the observation, not the call. |
| `CBR_ENVIRONMENT` | `development` | `production` refuses to start unsafely. See below. |

`CBR_ENVIRONMENT=production` will not start without: a unique secret key of at
least 32 characters, a changed curator password of at least 14, `CALLER_MODE=calle`,
a non-empty allowlist, spacing of at least one day, sample data off, HTTPS on, an
`https` public base URL, a named trusted proxy, and real hostnames in
`CBR_ALLOWED_HOSTS`.

## Who may ask for a call

Every route that reads a run, a transcript, a decision or the ledger needs a
session, and every route that changes something needs the session's CSRF token
as well. The public directory has two routes that touch a phone call:

- `POST /api/verify-now` starts one. A signed-in curator is always allowed. A
  visitor is allowed when `CBR_ALLOW_PUBLIC_VERIFICATION` is true, or is unset
  on a deployment whose caller is the pilot line. A deployment with
  `CBR_CALLER_MODE=calle` and the flag unset answers a visitor with 401: the
  five eligibility gates decide whether a number may be called, and this decides
  whether an anonymous stranger may spend that permission. When the route is
  open, one address gets six requests a minute and the whole deployment gets
  `CBR_PUBLIC_VERIFICATION_DAILY_LIMIT` a day, counted in the process and reset
  at midnight UTC; the console's `/api/system` reports what is left.
- `GET /api/verifications/{task_id}` follows one. A session sees the run. A
  visitor sees state, detail and what changed in the public record, and only
  with the `ticket` that came back from the request that started the call, as a
  query parameter or an `X-Verification-Ticket` header. Task ids are
  guessable; tickets are not.

`GET /api/directory/services/{id}` still says whether a call is happening for a
record, with the same projection and no more.

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

## Hosting a demonstration

`Dockerfile` builds the whole product into one image, and `render.yaml` brings it
up on a free Render web service at `https://callibrate.onrender.com`.

```bash
docker build -t callibrate .
docker run -p 8000:8000 -e CBR_ALLOWED_HOSTS=localhost callibrate
```

A hosted copy runs `CBR_CALLER_MODE=pilot`, which puts the same contract, the
same evidence rules, the same policy and the same ledger behind a scripted
conversation and dials nothing. Live calling wants a CALL-E token and an explicit
`CBR_CALL_ALLOWLIST`, and a public URL is the wrong place for both. The database
is seeded when it is empty, so an instance with no disk is the seeded directory
again every time it wakes up.

## Backups

```python
Store("data/callibrate.db").backup_to("backups/callibrate-2026-09-10.db")
```

Uses SQLite's own online backup, so it is safe against a running server.
