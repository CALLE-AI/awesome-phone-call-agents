# Genesis CALL-E Orchestrator

Genesis CALL-E Orchestrator is a focused Python demo app that turns three common business outcomes into safe, structured CALL-E phone workflows:

- appointment booking returns a confirmation and a calendar-draft action;
- consent-aware lead qualification returns a score, opt-out state, and CRM follow-up draft; and
- service/vendor coordination returns comparable pricing and availability without accepting a quote or authorizing payment.

The default mode is a masked preview and never places a call. A deterministic simulation demonstrates the complete plan, conversation-result, and follow-up flow without credentials. Live mode makes exactly one CALL-E SDK call at runtime and requires three independent gates: an authorized-recipient assertion in the request, `CALLE_LIVE_CALLS_ENABLED=true`, and `--confirm-authorized-recipient`.

## Setup

Python 3.11 or later is required.

```bash
cd apps/python/genesis-call-e-orchestrator
python -m venv .venv
. .venv/bin/activate
python -m pip install "calle-ai==0.6.0" "pytest>=8,<10"
```

On Windows, activate with `.venv\Scripts\activate`.

## Preview: no call

```bash
python client.py --request example_appointment.json
python client.py --request example_lead.json
python client.py --request example_vendor.json
```

The preview masks the phone number and prints the exact CALL-E task and JSON Schema.

## Simulate all product stages

```bash
python client.py --request example_appointment.json --simulate
python client.py --request example_lead.json --simulate
python client.py --request example_vendor.json --simulate
```

Simulation produces schema-shaped results and the next operational action. It never imports the SDK and never contacts CALL-E.

## Run one live CALL-E call

Use a number you own or are authorized to call. Keep the key server-side in the environment and replace the reserved example number in a reviewed request file.

```bash
export CALLE_API_KEY="<CALL_E_API_KEY>"
export CALLE_BASE_URL="https://api.heycall-e.com"
export CALLE_LIVE_CALLS_ENABLED="true"

python client.py \
  --request your_authorized_request.json \
  --execute \
  --confirm-authorized-recipient \
  --output call-result.json
```

Live mode imports the published `calle-ai==0.6.0` package and calls `CalleClient.calls.create_and_wait(...)` with an explicit recipient, task, recipient result schema, metadata, and a deterministic idempotency key. The output contains a masked number, structured result, and follow-up action. Output files use exclusive creation and are never overwritten.

## Input contract

Every request includes:

- one scenario: `appointment_booking`, `lead_qualification`, or `vendor_coordination`;
- one explicit E.164 phone number (the app never guesses a country code);
- `authorized_recipient: true`;
- optional `region` and `locale`; and
- a scenario-specific `context` object.

CALL-E validates destination coverage before dialing. Region/language availability
is provider-controlled and may change; an unsupported combination returns a safe
pre-call error with no call ID. Use only a combination CALL-E currently lists as
supported, and do not relabel a destination or language to bypass that policy.

Examples use the fictional North American range `+1 415-555-0100`.

## Safety and side effects

- Preview and simulation have no external side effects.
- Live mode places exactly one outbound call; it has no recurrence or hidden retry loop.
- The prompt requires AI identity and represented-organization disclosure, permission to continue, and opt-out handling.
- Phone numbers are masked in all returned summaries.
- API keys are read only from environment variables and are never included in output.
- Lead calls cannot pressure recipients or collect sensitive personal data.
- Vendor calls cannot accept quotes, sign contracts, or authorize payment.
- Appointment calls cannot authorize charges or invent availability.
- The workflows are not for medical advice, legal advice, financial transactions, emergencies, political persuasion, or deceptive impersonation.

## Cancellation and rollback

Omit `--execute`, leave `CALLE_LIVE_CALLS_ENABLED` unset, or omit the confirmation flag to prevent a call. CALL-E 0.6 exposes no cancel/terminate endpoint, so after CALL-E accepts a task this app cannot stop it remotely. Follow-up actions are returned as drafts or recommendations and do not modify calendars, CRMs, or vendor systems.

## Tests

Tests never place a real call. The live-integration test injects a fake `CalleClient` and proves the published SDK surface is invoked with the phone, schema, metadata, and idempotency key.

```bash
python -m pytest -q
```

For repository submission, run the root validator:

```bash
python3 scripts/validate_repository.py
```
