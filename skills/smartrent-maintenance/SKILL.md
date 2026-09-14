---
name: smartrent-maintenance
description: Multi-call AI maintenance coordination: tenant intake, vendor dispatch, and tenant confirmation calls via CALL-E, with structured result schemas, evidence-backed outcomes, and a real-time web dashboard.
license: MIT
---

# SmartRent Maintenance — AI Maintenance Coordinator Skill

An agent skill that orchestrates a **3-call maintenance request workflow** using
CALL-E to coordinate tenants, property managers, and vendors entirely by phone.

## When to Use

Use this skill when a property manager or tenant submits a maintenance request
and the workflow needs to:

1. **Call the tenant** to gather detailed issue information (type, urgency,
   location, access instructions)
2. **Call available vendors** from a roster to find one who can handle the job,
   get their ETA and cost estimate
3. **Call the tenant back** to confirm the vendor visit, ETA, and cost

## Safety Boundaries

> Phone calls create real-world side effects. Read [`references/safety.md`](references/safety.md)
> and review [`references/examples.md`](references/examples.md) before deployment.

- **Dry-run by default**: Set `DRY_RUN=true` (default) to preview the workflow
  without placing real calls. Every call function returns realistic simulated
  data including transcripts and structured results.
- **Consent-gated**: The tenant initiated the maintenance request. Vendor calls
  go only to rostered vendors who have agreed to receive dispatch calls.
- **No autonomous commitments**: The skill finds a vendor and reports back — it
  does not sign contracts, authorize payments, or commit to schedules without
  tenant confirmation.
- **Human-in-the-loop**: The dashboard shows full call transcripts and evidence.
  A property manager can intervene at any step.
- **Idempotent calls**: Each CALL-E call uses an idempotency key to prevent
  duplicate calls on retry.
- **No cold outreach**: Vendor calls are to pre-authorized roster contacts only.
- **Structured evidence**: Every outcome is backed by CALL-E transcript evidence
  and confidence scores.

## Prerequisites

- Python 3.10+
- A CALL-E account with API key ([sign up](https://www.heycall-e.com/))
- `pip install calle-ai fastapi uvicorn pydantic python-dotenv`

## Quick Start

```bash
# Clone and set up
cd apps/python/smartrent-maintenance
pip install -r requirements.txt

# Configure (dry-run is default)
cp .env.example .env

# Run dry-run simulation
python3 ../../../skills/smartrent-maintenance/scripts/dry_run.py

# Run tests (no CALL-E credentials needed)
python3 -m pytest tests/ -v

# Start the dashboard
python3 -m app.main
# Open http://localhost:8000
```

## Workflow Architecture

Read the full state machine details in [`references/workflow.md`](references/workflow.md).

```
+-----------------+     +-----------------+     +-----------------+
|  1. TENANT      |     |  2. VENDOR      |     |  3. TENANT      |
|     INTAKE      |---->|     DISPATCH    |---->|     CONFIRM     |
|                 |     |                 |     |                 |
|  Gather:        |     |  Find:          |     |  Confirm:       |
|  - Issue type   |     |  - Available?   |     |  - Vendor name  |
|  - Urgency      |     |  - ETA          |     |  - ETA          |
|  - Location     |     |  - Cost estimate|     |  - Cost         |
|  - Access info  |     |  - Notes        |     |  - Yes/No       |
+-----------------+     +-----------------+     +-----------------+
     | result_schema         | result_schema         | result_schema
     | evidence              | evidence              | evidence
     | transcript            | transcript            | transcript
```

## CALL-E Integration Points

| Feature | Usage |
| --- | --- |
| Python SDK | `calle-ai` package - `CalleClient.calls.create_and_wait()` |
| `result_schema` | Typed JSON schemas for each call type |
| `evidence` | Transcript-backed evidence for each structured field |
| `completion_confidence` | Confidence scoring to validate call outcomes |
| `idempotency_key` | Prevents duplicate calls on retry |
| `webhook_url` | Optional webhook for async call completion |
| Structured results | Typed outcomes fed into workflow state machine |

## Result Schemas

### Tenant Intake
```json
{
  "issue_type": "plumbing|electrical|hvac|appliance|structural|pest|other",
  "urgency": "emergency|urgent|routine",
  "location_in_unit": "string",
  "access_instructions": "string",
  "additional_details": "string"
}
```

### Vendor Dispatch
```json
{
  "available": "yes|no|maybe",
  "eta": "string",
  "cost_estimate": "string",
  "notes": "string"
}
```

### Tenant Confirmation
```json
{
  "confirmed": "yes|no|reschedule",
  "preferred_time": "string",
  "notes": "string"
}
```

## API Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/` | Dashboard UI |
| `POST` | `/api/requests` | Create request + start workflow |
| `GET` | `/api/requests` | List all requests |
| `GET` | `/api/requests/{id}` | Get request details |
| `POST` | `/api/requests/{id}/step/{step}` | Trigger individual step |
| `GET` | `/api/dashboard` | Aggregated stats |
| `POST` | `/api/webhook/calle` | CALL-E webhook handler |

## Testing

```bash
# Run all tests (dry-run, no credentials needed)
python3 -m pytest tests/ -v
```

## References

- Follow [`references/safety.md`](references/safety.md) for phone safety principles.
- Follow [`references/examples.md`](references/examples.md) for safe and unsafe scenarios.
- Follow [`references/workflow.md`](references/workflow.md) for state transitions.
- [CALL-E Python SDK](https://github.com/CALLE-AI/call-e-integrations)
- [CALL-E API Docs](https://docs.heycall-e.com/)
- [CALL-E Installation Guide](https://open.heycall-e.com/document/mcp-archive/CALL-E-installation-guide.md)
