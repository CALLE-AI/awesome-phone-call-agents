# Python Clinic Stock Reporter App

This app calls rural health clinics through the CALL-E Developer API, runs a
short structured weekly HMIS stock and cold-chain interview over the phone,
extracts a schema-valid structured result from the call, and ingests it into a
local SQLite store that backs a district health office dashboard flagging
cold-chain breaks and stockouts for action.

It is a runnable demo, not a CALL-E SDK or a supported product API. It follows
the repository design principle "host scheduler handles recurrence; phone-call
provider handles exactly one call per scheduled run."

It uses the official CALL-E Python SDK (`calle-ai`) against the production
Developer API at `https://api.heycall-e.com`.

## What it does

1. Reads a clinic roster JSONL file (one clinic per line).
2. For each clinic, creates one CALL-E call task with a `task` instruction and
   a JSON Schema `result_schema` that describes the HMIS fields to extract.
3. Waits for the terminal call task and reads the schema-valid
   `structured_result` that CALL-E extracts from the transcript/ASR/summary.
4. Classifies the result as green, amber, or red and ingests it into SQLite.
5. Serves a dashboard at `http://127.0.0.1:8787` showing the latest reports
   and any pending red-flag escalations.

Structured results are native to the CALL-E Developer API: the app sends
`result_schema` on call creation, and CALL-E extracts and validates a
schema-valid `structured_result` from the call evidence. When CALL-E cannot
produce a schema-valid result, `structured_result` is `null` and the call is
still recorded (with all fields missing), not dropped.

## HMIS field subset

The interview collects a representative subset of Uganda HMIS105 / DVDMIS
weekly indicators. These mirror real DHIS2 fields but should be confirmed
against the live DHIS2 instance before any production use.

| Field | Type | Meaning | Red flag |
| --- | --- | --- | --- |
| `fridge_temp_c` | number | Vaccine fridge temperature in Celsius | Outside +2 to +8 |
| `arv_stockout` | yes/no/unknown | Out of stock of ARVs | yes |
| `antimalarial_stockout` | yes/no/unknown | Out of stock of antimalarials (ACT) | yes |
| `malaria_cases` | integer | Confirmed malaria cases this week | - |
| `anc_visits` | integer | New ANC1 first visits this week | - |
| `stockout_items` | string | Other essential medicines out of stock | any non-none |

Severity: red if a cold-chain break or ARV/antimalarial stockout; amber if any
other stockout; green otherwise.

## Setup

Requires Python 3.11+ and a CALL-E project API key.

1. Get an API key at <https://dashboard.heycall-e.com/account/api-keys>.
2. Set it in your environment:

```bash
export CALLE_API_KEY="calle_test_key"
```

3. Install dependencies:

```bash
uv sync --all-groups
```

## Usage

Dry run (preview each call payload without placing a call). This is the
default and costs zero calls:

```bash
uv run python client.py --input example_clinics.jsonl --dry-run
```

Execute (creates a real CALL-E call task per clinic and waits for the
structured result). Only do this when you intend to call the clinics:

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
  "locale": "en-UG",
  "metadata": {"district": "Nakaseke"}
}
```

`to_phones` must be E.164. `region` and `locale` are per-recipient routing
hints; CLI defaults are `US` and `en-US` if the roster omits them. `metadata`
is copied through to the call task and webhook payload and is used here for
tracing and the dashboard's `district` column. Use fictional or masked numbers
in samples.

## Region support

CALL-E call support is region- and language-gated per API key. The Uganda
roster in `example_clinics.jsonl` is the real-world deployment target; some
keys do not yet support the `UG`/`en-UG` combination and the call creation
will return an `unsupported_region` or `forbidden` error in that case. For a
live demo against a supported combination, set `region`/`locale` on the
roster line (for example `US`/`en-US`) to a combination your key supports.
This region gap is itself useful CALL-E feedback.

## Output

- `results/clinic_call_results.jsonl`: one record per clinic. Includes the
  parsed `report` (fields, missing, red_flags, severity), the raw
  `structured_result`, `status`, `call_id`, and duration. Dry runs include a
  `payload_preview`.
- `results/clinic_reports.db`: SQLite store backing the dashboard and
  escalations tables.
- `http://127.0.0.1:8787`: dashboard of latest reports and pending red-flag
  escalations.

## Credentials

Auth uses a project API key via the `CALLE_API_KEY` environment variable. The
key is sent only as a `Authorization: Bearer` header to
`https://api.heycall-e.com`. The app never prints the key. Do not commit a
roster containing real clinic phone numbers, and do not put the API key in
client-side or browser code; the Developer API is server-only.

## Side effects

- `--execute` creates a real outbound phone call task per clinic. Each call is
  a real-world side effect and may contact external people.
- A red severity row creates an escalation record in the SQLite store. The
  app does not send an SMS itself; the `escalations` table is the queue. Wiring
  it to a real SMS provider is out of scope for this demo and must be added
  before any production use.
- No provider-side recurring job is ever created. All recurrence is local.

## Dry-run, preview, and no-call behavior

- `--dry-run` (default) builds and records each call payload, including the
  `result_schema`, without sending a request to CALL-E. No call is placed.
- The dashboard and store work against whatever rows already exist; you can
  inspect the schema without making any calls.
- Tests use `httpx.MockTransport` to mock the Developer API. They never make a
  real network request, place a real call, or use real credentials.

## Cancellation and rollback

- Stop the scheduler with Ctrl-C. No upstream recurring job exists to cancel.
- A single in-flight call task cannot be cancelled through the Developer API
  methods used here (`create` + `wait_for_result`). Stopping the scheduler
  stops only the local loop, not a call already in progress.
- To clear local state, delete `results/clinic_call_results.jsonl` and
  `results/clinic_reports.db`. This does not undo any call already placed.
- Pass a stable `idempotency_key` (the app generates one per clinic run) so a
  retried create does not place a duplicate call.

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

Default tests use a mocked Developer API and require no CALL-E account or
network. Live verification is opt-in: set `CALLE_API_KEY`, then run the client
with `--execute` against a roster you are authorized to call, using a
region/locale your key supports.
