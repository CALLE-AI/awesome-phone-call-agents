# n8n Two-Agent Fixture Evidence

Verified: September 12, 2026

## Environment

- n8n version: `2.20.9`
- Workflow: `DineLine CALL-E - Two Agent Fixture Round Trip`
- Workflow ID: `DLECalleFixture01`
- Execution ID: `879`
- Execution mode: CLI
- External calls: none

## Command

With the DineLine server running in fixture mode on port `4173`:

```bash
npx n8n execute --id=DLECalleFixture01 --rawOutput
```

## Result

Execution `879` finished with status `success`. The final node,
`Assert Two Agent Round Trip`, returned:

```json
{
  "verification": "passed",
  "agents": 2,
  "intakeProviderCallId": "fixture-intake-1",
  "bookingProviderCallId": "fixture-1",
  "intakeJournalState": "completed",
  "bookingJournalState": "completed",
  "bookingStatus": "booked",
  "automaticRetryAllowed": false
}
```

The stored workflow was checked after execution and remained inactive. All
destinations in this proof use standards-reserved `202-555-01xx` numbers.

## What this proves

- Agent 1 request preview, approval binding, dispatch, and result verification
  complete through n8n.
- Agent 1's evidence-backed preferences cross the orchestration boundary.
- The booking contract is created and bound to its own approval fingerprint.
- Agent Jake's fixture dispatch and result verification complete independently.
- Both calls have separate journal states and correlation IDs.
- The workflow refuses automatic retries after dispatch.

## What this does not prove

- No real CALL-E phone call occurred.
- No live Google Places request occurred.
- The fixture execution is not evidence of production scalability or durable
  distributed idempotency.
