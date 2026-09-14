# SmartRent — AI Maintenance Coordinator

> **A multi-call AI workflow that coordinates property maintenance via real phone calls using [CALL-E](https://www.heycall-e.com/).**

SmartRent automates the entire maintenance request lifecycle with a 3-call orchestrated workflow:

1. 📞 **Tenant Intake Call** — AI calls the tenant to gather issue details (type, urgency, location, access)
2. 🔧 **Vendor Dispatch Call** — AI calls available vendors to find one with the right skills, ETA, and cost
3. ✅ **Tenant Confirmation Call** — AI calls the tenant back to confirm the vendor visit

Each call uses CALL-E's `result_schema` for structured data extraction, `evidence` for transcript-backed verification, and `completion_confidence` for outcome validation.

## 🏗️ Architecture

```
┌──────────────┐     ┌─────────────────────────────────────────┐
│  Dashboard   │────▶│          FastAPI Backend                 │
│  (SPA)       │◀────│                                         │
└──────────────┘     │  ┌─────────────────────────────────┐    │
                     │  │   Workflow Orchestrator          │    │
                     │  │                                  │    │
                     │  │   CREATED                        │    │
                     │  │     ↓ call_tenant_intake()       │    │
                     │  │   TENANT_CALLED                  │    │
                     │  │     ↓ call_vendor_dispatch()     │    │
                     │  │   VENDOR_FOUND                   │    │
                     │  │     ↓ call_tenant_confirm()      │    │
                     │  │   COMPLETED                      │    │
                     │  └──────────┬──────────────────────┘    │
                     │             │                            │
                     │  ┌──────────▼──────────────────────┐    │
                     │  │   CALL-E Python SDK              │    │
                     │  │   calle-ai · result_schema ·     │    │
                     │  │   evidence · confidence          │    │
                     │  └──────────┬──────────────────────┘    │
                     └─────────────┼────────────────────────────┘
                                   │
                     ┌─────────────▼────────────────────┐
                     │         CALL-E Platform           │
                     │   Real outbound phone calls       │
                     │   Natural conversation + AI       │
                     │   Structured result extraction     │
                     └───────────────────────────────────┘
```

## 🚀 Quick Start

### Prerequisites
- Python 3.10+
- A [CALL-E account](https://www.heycall-e.com/) with API key

### Setup

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/awesome-phone-call-agents.git
cd awesome-phone-call-agents/apps/python/smartrent-maintenance

# Install dependencies
pip install -r requirements.txt

# Configure (dry-run mode is default — no real calls)
cp .env.example .env
# Edit .env and add your CALLE_API_KEY

# Run tests (no credentials needed)
python -m pytest tests/ -v

# Start the dashboard
python -m app.main
# Open http://localhost:8000
```

### Create a Test Request

```bash
curl -X POST http://localhost:8000/api/requests \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_name": "John Smith",
    "tenant_phone": "+15551234567",
    "unit_number": "4B",
    "initial_description": "Kitchen sink is leaking"
  }'
```

The workflow will run automatically in the background, placing 3 calls (or simulating them in dry-run mode).

## 📞 CALL-E Integration

### SDK Usage

```python
from calle import CalleClient

client = CalleClient(api_key="your_api_key")

call = client.calls.create_and_wait(
    task="Call the tenant about their maintenance request...",
    recipients=[{
        "phones": ["+15551234567"],
        "region": "US",
        "locale": "en-US",
    }],
    result_schema={
        "type": "object",
        "required": ["issue_type", "urgency"],
        "properties": {
            "issue_type": {"type": "string", "enum": ["plumbing", "electrical", "hvac"]},
            "urgency": {"type": "string", "enum": ["emergency", "urgent", "routine"]},
        }
    },
    idempotency_key="tenant_intake_12345",
)

print(call["structured_result"])  # {"issue_type": "plumbing", "urgency": "urgent"}
print(call["evidence"])           # ["The tenant said the kitchen sink is leaking..."]
print(call["completion_confidence"])  # {"score": 0.94, "label": "high"}
```

### Result Schemas

| Call Type | Key Fields | Purpose |
|-----------|-----------|---------|
| Tenant Intake | `issue_type`, `urgency`, `location_in_unit`, `access_instructions` | Gather issue details |
| Vendor Dispatch | `available`, `eta`, `cost_estimate` | Find available vendor |
| Tenant Confirm | `confirmed`, `preferred_time` | Confirm vendor visit |

## 🧪 Testing

```bash
# Dry-run tests (no credentials needed)
python -m pytest tests/ -v

# Dry-run demo script
python skill/smartrent-maintenance/scripts/dry_run.py

# Live test (requires CALLE_API_KEY and DRY_RUN=false)
DRY_RUN=false python -m app.main
```

## 📁 Project Structure

```
smartrent-maintenance/
├── app/
│   ├── main.py              # FastAPI application & webhook handler
│   ├── calle_client.py      # CALL-E SDK async client (3 call types)
│   ├── models.py            # Pydantic models + result schemas
│   ├── workflows.py         # 3-call workflow orchestrator & vendor cascade
│   ├── db.py                # Zero-dependency SQLite persistence layer
│   └── config.py            # Configuration
├── frontend/
│   ├── index.html           # Enterprise dashboard SPA
│   ├── style.css            # Premium enterprise SaaS design system (editorial light mode)
│   └── app.js               # Dashboard logic & telemetry deck
├── skill/
│   └── smartrent-maintenance/
│       ├── SKILL.md          # Agent Skill definition
│       ├── references/       # Workflow, safety, and example documentation
│       └── scripts/          # Dry-run CLI demo
├── tests/
│   └── test_workflow.py     # Comprehensive test suite (async, resilience, API)
├── requirements.txt
└── .env.example
```

## 🛡️ Safety

- **Dry-run by default** — no real calls without explicit `DRY_RUN=false`
- **Consent-gated** — tenant initiated the request, vendors are pre-authorized
- **No autonomous commitments** — reports back, never signs contracts
- **Idempotent** — duplicate calls prevented via idempotency keys
- **Evidence-backed** — every outcome verified against transcript evidence

## 📄 License

MIT
