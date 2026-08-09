# IncidentBridge

![IncidentBridge incident-to-call-to-evidence workflow](assets/incidentbridge-cover.png)

**A consent-first CALL-E agent that turns a vendor-support phone call into structured incident
evidence without pretending the service recovered.**

When a critical SaaS or data dependency fails, operators often lose time waiting on a support line,
repeating context, and manually copying a ticket number and ETA into an incident channel.
IncidentBridge places one explicitly authorized phone call, discloses that it is AI, gathers a strict
result, and returns either `vendor_acknowledged` or `needs_human`.

The phone result can never close the incident. Local health checks and a human incident commander
retain recovery authority.

## Safety model

```text
incident → validated, non-secret briefing → masked preview → exact phone allowlist
         → durable reservation → CALL-E SDK → strict result schema
         → vendor acknowledged / needs human → local recovery verification
```

- Preview is the default and never calls anyone.
- Live mode requires an authorized business contact in the request, the exact E.164 phone number in
  `--allow`, `--confirm-authorized-recipient`, `CALLE_LIVE_CALLS_ENABLED=true`, and a server-side
  `CALLE_API_KEY`.
- A SQLite reservation is written before provider dispatch. Any repeat or ambiguous outcome is
  locked for reconciliation instead of redialed.
- The task requests no credentials, authentication codes, personal data, payment data, or contract
  changes.
- Wrong desk, declined AI disclosure, low confidence, incomplete schema, uncertain provider state,
  or requested escalation all fail closed to `needs_human`.
- Phone numbers, email addresses, and credential-like strings are redacted from returned free text.

## Install

```bash
uv venv --python 3.12 .venv
uv sync --extra dev
```

## Preview — no phone call

```bash
.venv/bin/incidentbridge --request examples/incident.json
```

The output includes the masked recipient, exact CALL-E task, strict JSON Schema, stable idempotency
key, and decision boundary.

## Simulate the complete result path — no phone call

```bash
.venv/bin/incidentbridge --request examples/incident.json --simulate acknowledged
.venv/bin/incidentbridge --request examples/incident.json --simulate wrong-desk
.venv/bin/incidentbridge --request examples/incident.json --simulate eta-unknown
```

## Execute one real CALL-E call

Use a phone number you own or have documented authorization to call. Replace the reserved example
number and keep credentials in the environment:

```bash
export CALLE_API_KEY="<CALL_E_API_KEY>"
export CALLE_LIVE_CALLS_ENABLED="true"

.venv/bin/incidentbridge \
  --request your-authorized-incident.json \
  --execute \
  --confirm-authorized-recipient \
  --allow +15555550100 \
  --database data/incidentbridge.sqlite3 \
  --output artifacts/live-result.json
```

The output path uses exclusive creation and will not overwrite an earlier audit result. If the SDK
accepts the call but polling fails, the reservation becomes `outcome_unknown`; inspect it before any
new call attempt.

## Structured output

CALL-E is asked for:

- correct support desk and consent after AI disclosure;
- incident acknowledgment and vendor ticket identifier;
- `investigating`, `identified`, `monitoring`, `resolved`, or `unknown` vendor status;
- ETA in minutes, a bounded workaround summary, and callback window; and
- explicit human-escalation need plus a short evidence summary.

Even when the vendor says `resolved`, IncidentBridge returns `incident_closed: "false"`.

## Test the real SDK boundary

```bash
.venv/bin/ruff check .
.venv/bin/pytest --cov=src/incidentbridge --cov-report=term-missing --cov-fail-under=90
```

The integration test runs the published `calle-ai==0.2.0` SDK against a loopback capture server and
asserts the observed `POST /v1/calls`, bearer authentication, idempotency header, strict schema, and
`GET /v1/calls/{id}` poll. It proves CALL-E is imported and called at runtime without placing a real
phone call during tests.

## Scope

IncidentBridge coordinates a single business support conversation. It is not emergency response,
medical or legal advice, a recovery verifier, a contract agent, an auto-retry system, or a general
outbound campaign tool.

See [`THIRD_PARTY.md`](THIRD_PARTY.md) for the reuse boundary and
[`ADR-0001`](docs/architecture/adr-0001-official-calle-sdk.md) for the integration decision.

MIT licensed.
