# CallProof

CallProof is a runnable Rails workflow that checks whether a goal-driven phone
call did what the operator authorized, cites the transcript turns supporting the
verdict, and pauses for human review when the call crossed a policy boundary.

It combines three separately owned planes:

- CALL-E executes the phone task and returns structured results plus transcript;
- Call Analyzer evaluates the result against an immutable `CallContract`;
- AgentKit Rails persists the workflow, human decision, audit trail, and telemetry.

The default demo is deterministic and never places a call. It is intended to
show the verification loop without credentials or external network access.

## Directory layout

```text
callproof/
├── rails/          # Rails product and AgentKit control plane
├── call_analyzer/  # FastAPI evaluation service with inline or RQ execution
├── contracts/      # Versioned JSON Schemas shared across both runtimes
└── compose.yaml    # Redis, analyzer API, and analyzer worker
```

This package is generated from the primary CallProof monorepo. Runtime files in
the three directories should be changed in the monorepo and synchronized with
`hackathon/build_upstream_package.sh`.

## Try it without an account

Requirements:

- Ruby 3.4.1
- PostgreSQL with the `vector` extension
- Python 3.11 or newer for the analyzer tests

Run Rails in no-call mode:

```bash
cd rails
bundle install
bin/rails db:prepare
bin/rails test
bin/rails server
```

Open `http://localhost:3000` and run either deterministic scenario:

- compliant: the fictional delivery change stays below the $250 policy limit;
- violation: the fake caller accepts $320, Call Analyzer cites the transcript,
  and AgentKit suspends the flow at a persisted human-approval gate.

The default environment uses `CALLPROOF_CALL_PROVIDER=fake`,
`CALLPROOF_ANALYZER_ADAPTER=fake`, and the AgentKit fake LLM adapter. No CALL-E
key is needed and no phone endpoint is contacted.

Run the analyzer contract suite separately:

```bash
cd call_analyzer
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
pytest -q
```

`docker compose up --build` starts Redis, the analyzer API, and its RQ worker.
Webhook delivery remains disabled unless explicitly enabled. Rails can run on
the host and use the deterministic adapter while the service is inspected.

## Preview and confirmation

The optional live path is deliberately two-step:

1. The operator enters an E.164 recipient, objective, region, and commitment
   limit. Rails persists an immutable preview and contacts nothing.
2. A separate page masks the number, shows the exact contract and its SHA-256,
   displays readiness gates, and requires a request-specific typed phrase.

The final button stays disabled until all three server-side prerequisites are
present: the `calle` provider, the exact live switch, and an API key. A browser
confirmation is still required after those checks.

## One opt-in live call

This section describes a real-world side effect. Do not enable it with a phone
number you do not have permission to call.

```bash
export CALLPROOF_CALL_PROVIDER=calle
export CALLPROOF_LIVE_CALLS=true
export CALLE_API_KEY='<CALL_E_API_KEY>'
export CALLE_BASE_URL='https://api.heycall-e.com'
export CALLE_WEBHOOK_URL='https://your-public-host.example/calle/webhook'
```

The Rails adapter submits one `POST /v1/calls` request with a stable
`Idempotency-Key`. It polls `GET /v1/calls/{call_id}` for recovery, normalizes
terminal transcript turns, and passes the evidence to Call Analyzer. The API key
is read only from the environment and is never stored in a call, contract,
transcript, prompt, or fixture.

No live call was made while developing or testing this contribution.

## Side effects and cancellation

- Preview, deterministic demo, tests, and analyzer `inline` mode place no calls.
- Confirming a live request can place exactly one outbound CALL-E call.
- The idempotency key is stable for the request, so retries do not intentionally
  create another call.
- A draft can be canceled before confirmation and remains as an auditable
  `canceled` record. Cancellation does not delete data.
- After CALL-E has accepted a call, this demo does not claim it can recall or
  terminate a connected call. Stop future polling and use provider controls if
  CALL-E exposes cancellation for that call state.
- There is no recurring schedule and therefore no hidden future job to remove.

## Data and safety boundaries

- Samples use fictional reserved numbers. UI summaries mask E.164 recipients.
- Do not use this delivery-change demo for medical, legal, financial, emergency,
  debt-collection, or other high-impact decisions.
- Credentials never enter prompts or persisted payloads.
- Analyzer callbacks use an HMAC signature, a five-minute timestamp window, and
  event-id replay protection.
- A verdict cites transcript turn identifiers; it does not silently trust the
  provider's structured extraction.
- Policy violations and low-confidence outcomes require human review before
  they become accepted outcomes or learning evidence.

## Verification

```bash
cd rails
bundle exec rails test
bundle exec rubocop
bundle exec rails zeitwerk:check
bundle exec brakeman --no-pager -q

cd ../call_analyzer
pytest -q
```

The repository defaults are safe to run without credentials. Live verification
is intentionally opt-in and must use an authorized test recipient.

## Status and limitations

This is a focused hackathon demo, not a CALL-E SDK or supported product API.
The analyzer currently uses SQLite for the local RQ stack; use PostgreSQL before
deploying API and workers across multiple hosts. The accessible public CALL-E
reference did not provide enough webhook-signature detail to implement a verifier
without guessing, so terminal recovery uses the documented GET endpoint.

