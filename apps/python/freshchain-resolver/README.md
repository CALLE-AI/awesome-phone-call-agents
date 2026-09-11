# FreshChain Resolver

FreshChain Resolver is a focused Python application that uses the CALL-E server SDK to resolve cold-chain delivery exceptions by phone. When a temperature-controlled shipment will miss its receiving window, the agent calls an authorized site operations contact, discloses that it is AI, confirms whether the delayed load can be received, captures dock and check-in instructions, and returns a schema-validated routing decision.

The default mode is a masked preview and never places a call. A deterministic simulation makes the complete product flow demonstrable without credentials. The included web MVP provides a delivery-exception input form plus a SQLite-backed call-history and final-decision dashboard. Live mode creates exactly one CALL-E task at runtime.

## Why this workflow

A delayed refrigerated load often triggers a chain of manual calls among dispatchers, receiving desks, and quality teams. A missed handoff can mean driver detention, a failed delivery, or avoidable waste. FreshChain converts one time-sensitive phone conversation into one of four operational routes:

- `proceed` when the authorized site confirms it can receive at the ETA;
- `rebook` when the site declines the ETA and supplies a next window;
- `hold` whenever temperature status is not confirmed within range; or
- `escalate` when consent, identity, or the outcome is unclear.

The agent never decides whether a product is safe, overrides a quality hold, authorizes disposal, or promises acceptance.

## Setup

Python 3.11 or later is required. Using `uv`:

```bash
cd apps/python/freshchain-resolver
uv sync
```

Or use a virtual environment and install the published CALL-E SDK. Windows
also needs the `tzdata` package for IANA timezones:

```bash
python -m pip install "calle-ai==0.2.0" "tzdata>=2025.2"
```

## Preview: no phone call

```bash
python client.py --request example_request.json
```

The output masks the E.164 phone number and shows the exact CALL-E task, strict result schema, idempotency key, and pre-call route.

## Simulate the complete workflow

The three deterministic demo paths never contact CALL-E:

```bash
python client.py --request example_request.json --simulate accept
python client.py --request example_request.json --simulate rebook
python client.py --request example_request.json --simulate no-consent
```

Each returns a schema-shaped call result plus the downstream operational decision. This is suitable for automated tests and the first portion of a demo video.

## Run the web MVP

The dashboard uses Python's standard-library HTTP server and SQLite:

```bash
python app.py
```

Open `http://127.0.0.1:8080`. The interface provides a validated delivery-delay
form, explicit authorization and E.164 inputs, three no-call simulation paths,
persisted call attempts, and final `proceed`, `rebook`, `hold`, or `escalate`
decisions.

Live calling is server-side only; the browser never receives the API key.
When live mode is enabled, the server refuses non-loopback
`FRESHCHAIN_HOST` values and requires a whitespace-free
`FRESHCHAIN_LIVE_TOKEN` of at least 32 characters. Every state-changing API
request requires that token as a Bearer credential. To create a case and
trigger its live call after configuring the environment:

```bash
export FRESHCHAIN_LIVE_TOKEN="<32-or-more-random-characters>"

curl http://127.0.0.1:8080/api/cases \
  --request POST \
  --header "Authorization: Bearer $FRESHCHAIN_LIVE_TOKEN" \
  --header "Content-Type: application/json" \
  --data @your-authorized-request.json

curl http://127.0.0.1:8080/api/cases/1/execute \
  --request POST \
  --header "Authorization: Bearer $FRESHCHAIN_LIVE_TOKEN" \
  --header "X-Confirm-Live-Call: I understand this places a real phone call"
```

## Run one live CALL-E call

Replace the reserved example number with a phone number you own or are authorized to call. Confirm that the number belongs to an authorized operational contact. Keep the CALL-E key in an environment variable:

```bash
export CALLE_API_KEY="<CALL_E_API_KEY>"
export CALLE_BASE_URL="https://api.heycall-e.com"
export CALLE_LIVE_CALLS_ENABLED="true"
export CALLE_TIMEOUT_SECONDS="600"

python client.py \
  --request your-authorized-request.json \
  --execute \
  --confirm-authorized-recipient \
  --database ./data/freshchain.sqlite3 \
  --output new-call-result.json
```

Live mode imports `CalleClient` from the published `calle-ai` package, calls
`client.calls.create(...)`, persists the accepted call ID, and then waits for
the terminal result with `client.calls.wait_for_result(...)`. The idempotency
key is a SHA-256 digest of the canonical task, recipients, result schema, and
metadata, so an exact retry is deduplicated while any call-content change gets
a new key. Both the web and CLI live paths atomically claim the case in SQLite,
reject concurrent execution, persist the accepted call ID before polling, and
update the same audit attempt after completion. Timeouts and network failures
are recorded as `outcome_unknown` and route to human escalation so an
operator can reconcile the accepted call before any retry.

Simulation appends an audit attempt only. It never changes the case status or
decision, so it cannot clear a `calling` or `outcome_unknown` live safety lock.

Output files use exclusive creation and are never overwritten.

Copy `.env.example` into the deployment's secret configuration; the app does
not automatically load `.env` files. Keep `CALLE_LIVE_CALLS_ENABLED=false`
until the account key, authorized recipient, request contents, and confirmation
path have all been reviewed. `CALLE_BASE_URL` is the explicit endpoint switch;
production is restricted to `https://api.heycall-e.com`. Plain HTTP is accepted
only for an exact `127.0.0.1` or `localhost` test server with an explicit port.
The CLI and web app both require `CALLE_LIVE_CALLS_ENABLED=true`. The web app
additionally refuses live mode outside an exact loopback bind and requires the
Bearer token for all POST routes. `run-live.ps1` generates a process-local
token and prints it for the authorized local operator.

On Windows, `run-live.ps1` prompts for the API key with masked input, keeps it
only in the child process environment, and clears it when the server exits:

```powershell
.\run-live.ps1
```

## Input contract

The request JSON contains:

- stable, non-secret workflow and shipment references;
- one E.164 operational-contact phone number;
- an explicit `authorized_operational_contact: true` assertion;
- caller and receiving-site display names;
- a non-sensitive product category;
- predicted arrival and scheduled window end in local `YYYY-MM-DDTHH:MM` form;
- an IANA timezone and call locale; and
- `temperature_status`: `within_range`, `unknown`, or `excursion`.

Do not include driver names, personal contact details beyond the required business phone, customer data, credentials, authentication data, or regulated product details.

## Safety and side effects

- Preview and simulation modes have no external side effects.
- Live mode places one real outbound call and requires a separate confirmation flag.
- Web live mode is loopback-only and authenticates every state-changing API
  request with a strong process-local Bearer token.
- CLI and web live execution share SQLite claims, accepted-call auditing,
  ambiguity recording, and retry locks.
- The task discloses AI identity and asks permission to continue.
- A wrong desk receives no shipment detail.
- Unknown or excursion temperature status always routes to a human quality review.
- The agent coordinates logistics only; it cannot make safety, medical, legal, financial, emergency, or disposal decisions.
- Phone numbers are masked in previews and redacted from returned free text.
- Dashboard create/list responses mask stored phone numbers.
- Non-terminal, failed, incomplete, low-confidence, malformed, or
  human-escalation results always route to `escalate`.
- Transcripts and provider evidence are deliberately excluded from app output.
- The app creates no recurring schedule and no hidden follow-up call.

## Cancellation and rollback

Omit `--execute` or the confirmation flag to prevent a call. After CALL-E accepts a call task, this small app cannot guarantee cancellation; use the CALL-E dashboard or provider controls if cancellation is available. No recurring job remains to disable. Rebooking is returned as a recommendation for a human or downstream authorized system; this app does not modify a transport or warehouse system.

## Tests

Tests run in a virtual environment and never dial a phone. The SDK integration
test uses the published `calle-ai==0.2.0` SDK against a local HTTP capture
server. It asserts that the SDK actually sends `POST /v1/calls` with
authorization and idempotency headers, then polls `GET /v1/calls/{id}`. This
runtime proof is separate from simulation mode:

```bash
python -m pytest -q -o log_cli=true --log-cli-level=INFO
```

The runtime test itself is the reproducible proof: it starts a loopback capture
server, executes the published SDK, and asserts the observed POST, GET,
authorization, idempotency, and structured-result behavior.

For repository submission, place this directory at `apps/python/freshchain-resolver`, add its entry to the root resource list, and run:

```bash
python3 scripts/validate_repository.py
```
