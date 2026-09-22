# DineLine CALL-E n8n Artifacts

These workflows are sanitized, inactive copies. They contain no API keys,
credentials, private phone numbers, or production webhook identifiers.

## Native integration

`dineline-calle-edition.workflow.json` contains two separate webhook paths:

1. `Start CALL-E Dinner Plan` validates diner consent, binds a CALL-E Agent 1
   request, dispatches the preference agent once, and accepts only an
   evidence-backed structured result.
2. A Google Places text search normalizes, ranks, and caches five restaurant
   choices.
3. `Submit Approved Restaurant` accepts the user's selected result ID, recovers
   that result from the cache, creates the booking draft, and binds the exact
   fingerprint.
4. Agent Jake is dispatched once through CALL-E. The verified result returns
   booking status, evidence, journal state, and retry policy.

Vapi is not present in this generated workflow. The original Vapi DineLine
projects remain untouched as rollback references.

## Fixture proof

`dineline-calle-fixture-roundtrip.workflow.json` executes the same trust
boundaries without a network call:

`Agent 1 fixture -> preference verification -> selected fictional restaurant -> booking approval -> Agent Jake fixture -> booking verification`

Each run binds its contracts to the n8n execution ID, so the proof can run again
without deleting prior idempotency evidence.

## Safety

- Both workflows import as inactive.
- Google Places reads `GOOGLE_PLACES_API_KEY` from an n8n variable; no key is
  embedded.
- The local server defaults to fixtures.
- Real Agent 1 and Agent 2 calls require separate server-side gates.
- Each real integration dispatch node has one attempt, a 330-second n8n timeout,
  and no automatic retry. That window exceeds the provider's bounded 300-second
  result wait without permitting a duplicate call.
- Fixture dispatch nodes retain a 150-second local timeout.
- A `dispatch_unknown` result must be reconciled manually.

Regenerate both JSON files with `npm run build:n8n`.

## Local proof commands

Keep the forced-fixture DineLine server running on port `4173`, then run:

```bash
npm run build:n8n
npx n8n import:workflow --input=./n8n/dineline-calle-fixture-roundtrip.workflow.json
npx n8n execute --id=DLECalleFixture01 --rawOutput
```

If the n8n task-runner broker port is already in use, choose an unused broker
port for that shell before the execute command. For example, in PowerShell use
`$env:N8N_RUNNERS_BROKER_PORT='5680'`; in Bash use
`export N8N_RUNNERS_BROKER_PORT=5680`.

A passing run ends at `Assert Two Agent Round Trip` with `verification: passed`,
`agents: 2`, both journal states `completed`, booking status `booked`, and
`automaticRetryAllowed: false`.

Importing does not activate either workflow. Keep them inactive unless the
credentials, webhook exposure, exact destinations, and both call roles have
been reviewed. To roll back, deactivate the workflows and stop the isolated
DineLine server; no recurring schedule is created by these artifacts.
