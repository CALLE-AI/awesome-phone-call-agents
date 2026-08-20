# Python Outcome Reconciler App

Resolves a CALL-E call reference to exactly one terminal outcome, and says
`unresolved` — with a reason and the raw upstream payload — rather than guessing
when the public contract does not answer the question.

Companion to the [`call-outcome-reconciler`](../../../skills/call-outcome-reconciler/)
skill. Both read the same mapping table; the skill owns it and this app ships a
synchronised copy.

This is not a CALL-E SDK and does not define a supported application API.

## Side effects

**This app places no calls.** It reads the status of a call reference that
already exists. It holds no recipient list, creates no schedules, starts no
background jobs, and writes nothing outside the file you name with `--output`.

The only outbound network traffic is a status read against the CALL-E API, and
only when you run `reconcile` without `--dry-run`.

## Setup

Requires Python 3.10+ and [`uv`](https://docs.astral.sh/uv/).

```bash
cd apps/python/outcome-reconciler
uv sync
```

No credentials are needed for anything in the next section.

## Dry run first

Every scenario ships as a recorded fixture. These make no network request:

```bash
uv run python cli.py replay --fixture fixtures/happy.json
uv run python cli.py replay --fixture fixtures/stuck.json --max-observations 5
uv run python cli.py replay --fixture fixtures/zero_duration_decline.json --output out.json
uv run python cli.py explain --record out.json
```

`--dry-run` on the `reconcile` command does the same thing and refuses to run
without a fixture, so it can never fall back to a live request:

```bash
uv run python cli.py reconcile --call-ref call_example --dry-run --fixture fixtures/happy.json
```

Inspect the mapping table as loaded:

```bash
uv run python cli.py show-map
```

## Running against a live call

```bash
export CALLE_API_KEY=...
uv run python cli.py reconcile --call-ref <call reference>
```

Nothing here reads a `.env` file — no app in this repository does. Copy
`.env.example` to `.env` (it is gitignored) and load it into the shell yourself:

```bash
set -a && source .env && set +a
```

The base URL defaults to `https://api.heycall-e.com`, and `CALLE_API_KEY` is only
ever sent there or to loopback. Any other host — including
`api.heycall-e.com.attacker.example`, a plain-http variant, or one carrying a
port, path, query or embedded credentials — is refused **before the key is
read**, so a mistyped or hostile base URL cannot leak it. A warning would be no
use at that point: the credential would already have gone. Override with
`--base-url` or `CALLE_BASE_URL`; loopback is allowed over http so the local fake
server works.

Note the `servers:` entry in the v0.6.0 OpenAPI contract calls this host a
"Placeholder developer API base URL". That wording is stale — the
[authentication docs](https://docs.heycall-e.com/authentication) document a live
request against this exact origin.

For the Goal Runs surface — the only place `not_connected` and `declined` are
documented, and so the only place they can be obtained from a live call:

```bash
uv run python cli.py reconcile \
  --surface rest.goal_runs \
  --goal-id <goal id> \
  --call-ref <GoalRun.id>
```

`--call-ref` is the `GoalRun.id` returned by create. The contract is explicit
that the nested telephone `run_id` is not valid in this path.

For the MCP surface, authenticate with the CALL-E CLI first
(`npm install -g @call-e/cli && calle auth login`), then:

```bash
uv run python cli.py reconcile \
  --call-ref <run id> \
  --surface mcp.get_call_run \
  --mcp-server-url <server url>
```

`--token-cache` is optional: the cache path is derived from the server URL the
same way `@call-e/cli` writes it (`~/.calle-mcp/cli/<md5 of server url>/token.json`),
so there is no file to go looking for. Pass it only to override that.

`--request-timeout` (default 15s) bounds each individual read. A read that times
out is reported as `plan_timeout`, which is deliberately distinct from an
exhausted budget: one means the state could not be read, the other that the call
never reached a terminal state.

Exit codes: `0` resolved, `2` unresolved, `1` error. A workflow can branch on
the exit code without parsing the record.

## Credentials

* The REST surface reads `CALLE_API_KEY` from the environment.
* The MCP surface reuses the token cache written by `@call-e/cli`; this app runs
  no OAuth flow of its own.
* Credentials are never logged, printed, or persisted by this app, and never
  written into an outcome record.
* Do not paste a token into chat and do not commit one.
* Missing credentials stop the run with a credential message and exit code `1`.
  They deliberately do not produce an `unresolved` record: a setup mistake must
  not look like an ambiguous call outcome.

## Cancellation

Polling runs in the foreground. Interrupt it (Ctrl-C) and it stops immediately.
Nothing is scheduled, nothing runs in the background, and there is no job to
cancel afterwards.

Reconciling the same call reference again later is safe and side-effect free: it
produces a new record from fresh observations. That is the supported way to
revisit a call left `unresolved` because no terminal state had arrived yet.

## Budgets

Polling always terminates. Two budgets run concurrently and whichever trips
first ends it.

| Flag | Default | Purpose |
| --- | --- | --- |
| `--max-seconds` | 900 | Wall-clock budget. |
| `--max-observations` | 60 | Observation budget. |
| `--initial-backoff` | 2.0 | First delay between polls. |
| `--max-backoff` | 60.0 | Delay ceiling. |

Backoff is exponential with ±10% jitter and never overruns the remaining
wall-clock budget. See
[`polling-policy.md`](../../../skills/call-outcome-reconciler/references/polling-policy.md).

## Handling the record

An outcome record preserves the upstream payload verbatim — that is a core
guarantee, and it is why unknown fields survive. It also means that if upstream
returns an unmasked phone number, the record contains it. Treat a record as call
data: store it where you already store call data, and redact before sharing it.

Human-readable output masks the recipient (`+1555010****`). The `explain` view
is safe to share; it never prints the raw payload.

## Tests

```bash
uv run pytest -q
```

The default suite uses a local fake status server and recorded fixtures, so it
requires no CALL-E credentials, no browser login, and places no calls. Live
verification is opt-in and is not needed to review this app.

| File | Covers |
| --- | --- |
| `test_mapping.py` | Table validation, the documented-only rule, surface isolation, field paths. |
| `test_reconciler.py` | Every fixture scenario, each guard, raw fidelity, idempotence, the property test. |
| `test_poller.py` | Budgets, backoff, transport retries, timeout classification, credential handling. |
| `test_e2e.py` | The CLI over real HTTP against `fake_status_server.py`. |
| `test_mcp_client.py` | The MCP client over real HTTP against `apps/shared/fake-mcp-broker-server.mjs`. Skipped without `node`. |

Run the fake server by hand if you want to poke at it:

```bash
uv run python fake_status_server.py --fixture fixtures/stuck.json
```

## Layout

| File | Role |
| --- | --- |
| `cli.py` | `reconcile`, `replay`, `explain`, `show-map`. |
| `reconciler.py` | The state machine. Pure: no network, no clock. |
| `poller.py` | Backoff and the two budgets. Clock and sleep injected. |
| `mapping.py` | Loader for the mapping table. Holds no semantics of its own. |
| `record.py` | Record construction and raw preservation. |
| `clients.py` | Replay, Calls, Goal Runs, and MCP status clients. |
| `outcome-code-map.yaml` | Synchronised copy of the skill's table. Do not edit here. |

To change the mapping, edit the skill's copy and run:

```bash
node ../../../skills/call-outcome-reconciler/scripts/sync-mapping.mjs
```

The test suite fails if the two copies drift.
