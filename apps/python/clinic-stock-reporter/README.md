# Python Clinic Stock Reporter App

This app calls rural health clinics through CALL-E, runs a short structured
weekly HMIS stock and cold-chain interview over the phone, parses the agent's
structured summary into a row in a local SQLite store, and serves a district
health office dashboard that flags cold-chain breaks and stockouts for action.

It is a runnable demo, not a CALL-E SDK or a supported product API. It follows
the repository design principle "host scheduler handles recurrence; phone-call
provider handles exactly one call per scheduled run."

## What it does

1. Reads a clinic roster JSONL file (one clinic per line).
2. For each clinic, builds a deterministic `goal` that asks the nurse a fixed
   set of weekly HMIS questions and ends the call by stating a single
   machine-parseable `REPORT` line.
3. Calls CALL-E through the MCP tools `plan_call` -> `run_call` ->
   `get_call_run`, reusing the local `calle` CLI login state for auth.
4. Parses the `post_summary` of the completed call into structured fields,
   classifies the row as green, amber, or red, and ingests it into SQLite.
5. Serves a dashboard at `http://127.0.0.1:8787` showing the latest reports
   and any pending red-flag escalations.

The structured-result channel is CALL-E's `post_summary`. The agent is told to
state the report as a single line so it can be parsed deterministically:

```text
REPORT fridge_temp_c=4.5 arv_stockout=no antimalarial_stockout=yes malaria_cases=12 anc_visits=3 stockout_items=ACT
```

## HMIS field subset

The interview collects a representative subset of Uganda HMIS105 / DVDMIS
weekly indicators. These mirror real DHIS2 fields but should be confirmed
against the live DHIS2 instance before any production use.

| Field | Type | Meaning | Red flag |
| --- | --- | --- | --- |
| `fridge_temp_c` | float | Vaccine fridge temperature in Celsius | Outside +2 to +8 |
| `arv_stockout` | yes/no | Out of stock of ARVs | yes |
| `antimalarial_stockout` | yes/no | Out of stock of antimalarials (ACT) | yes |
| `malaria_cases` | int | Confirmed malaria cases this week | - |
| `anc_visits` | int | New ANC1 first visits this week | - |
| `stockout_items` | string | Other essential medicines out of stock | any non-empty |

Severity: red if a cold-chain break or ARV/antimalarial stockout; amber if any
other stockout; green otherwise.

## Setup

Requires Python 3.10+ and Node.js/npm for the `calle` CLI.

```bash
uv sync
npm install -g @call-e/cli
calle auth login
```

`calle auth login` opens a brokered browser login and caches the token under
`~/.calle-mcp/cli`. This app reads that cache, exactly like
`apps/python/batch-runner`.

## Usage

Dry run (plan_call only, no real call). This is the default:

```bash
uv run python client.py --input example_clinics.jsonl --dry-run
```

Execute (places real outbound calls). Only do this when you intend to call the
clinics in the roster:

```bash
uv run python client.py --input example_clinics.jsonl --execute
```

Run on a schedule. Dry-run by default; `--execute` for live calls; `--once`
for a single run instead of recurring:

```bash
uv run python scheduler.py --input example_clinics.jsonl --every-hours 168
```

Serve the dashboard (in another terminal):

```bash
uv run python -c "from ingest import Store, serve_dashboard; serve_dashboard(Store('results/clinic_reports.db'))"
```

Then open `http://127.0.0.1:8787`.

## Input format

```json
{
  "clinic_id": "hcii-kapeeka",
  "clinic_name": "Kapeeka HC II",
  "nurse_name": "Jane",
  "to_phones": ["+256700000001"],
  "region": "UG",
  "language": "English",
  "metadata": {"district": "Nakaseke"}
}
```

`to_phones` must be E.164. Use fictional or masked numbers in samples. The
`metadata` object is sent as MCP tool-call metadata (wrapped as
`call-e/customerMetadata`), not as a `plan_call` argument, and is used here for
tracing and the dashboard's `district` column.

## Output

- `results/clinic_call_results.jsonl`: one record per clinic. Includes the
  parsed `report` (fields, missing, invalid, red_flags, severity, raw), the
  `post_summary`, `final_status`, `run_id`, and duration. Dry runs include the
  `plan_result`.
- `results/clinic_reports.db`: SQLite store backing the dashboard and
  escalations tables.
- `http://127.0.0.1:8787`: dashboard of latest reports and pending red-flag
  escalations.

## Credentials

Auth reuses the `calle` CLI token cache. The app never prints or stores
access, refresh, or confirm tokens; they are redacted from all output and
result files. Do not commit a roster containing real clinic phone numbers.

## Side effects

- `--execute` places real outbound phone calls to the numbers in the roster.
  Each call is a real-world side effect and may contact external people.
- A red severity row creates an escalation record in the SQLite store. The
  app does not send an SMS itself; the `escalations` table is the queue. Wiring
  it to a real SMS provider is out of scope for this demo and must be added
  before any production use.
- No provider-side recurring job is ever created. All recurrence is local.

## Dry-run, preview, and no-call behavior

- `--dry-run` (default) calls `plan_call` only and stores the result. No call
  is placed.
- The dashboard and store work in dry-run mode against whatever rows already
  exist; you can inspect the schema without making any calls.
- Tests run against the shared fake MCP broker server and never place a real
  call or use real credentials.

## Cancellation and rollback

- Stop the scheduler with Ctrl-C. No upstream recurring job exists to cancel.
- A single in-flight `run_call` cannot be cancelled through the CALL-E MCP
  tools used here (`plan_call`, `run_call`, `get_call_run`). Stopping the
  scheduler stops only the local loop, not a call already in progress.
- To clear local state, delete `results/clinic_call_results.jsonl` and
  `results/clinic_reports.db`. This does not undo any call already placed.

## Safety boundaries

This app handles health data. It must not:

- diagnose, prescribe, or give medical advice during the call;
- contact patients directly; it interviews named clinic staff only;
- be used without confirming the HMIS field subset against the live DHIS2
  instance for any production deployment;
- be deployed without a real patient-data and privacy (HIPC) review for Uganda,
  which is out of scope for this demo.

Phone numbers in samples are fictional. Use E.164 numbers and explicit consent
before any real call.

## Live verification

Default tests use the shared fake MCP broker server and require no CALL-E
account. Live verification is opt-in: run `calle auth login`, then run the
client with `--execute` against a roster you are authorized to call.
