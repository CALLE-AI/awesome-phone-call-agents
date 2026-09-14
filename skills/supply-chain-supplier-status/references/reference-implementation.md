# Reference Implementation

A runnable reference application and operations dashboard for this skill is available at:
https://github.com/mohSadiq90/call-e-hackathon

This reference implementation provides a standalone procurement operations system that implements the 5-step conversational protocol, REST API dispatch contract, and procurement intelligence schemas.

## Capabilities & Architecture

1. **Interactive Executive Operations Dashboard (`src/html_dashboard.py` / `output/procurement_dashboard.html`):**
   - Real-time KPI summary (Total Calls, On-Time Fulfillment %, Disruptions, Financial Exposure, Escalations).
   - Multi-pill filter controls (`ALL`, `ON_TIME`, `DELAYED`, `PARTIAL_DISPATCH`, `UNREACHABLE`, `ESCALATIONS`).
   - Drill-down call inspection modal displaying conversational dialogue turns, root cause classification, and escalation contacts.
   - Dual operational modalities: Dense data table view and responsive card grid view.

2. **Zero-Credit Offline Mock Simulator (`src/calle_client.py`):**
   - High-fidelity offline simulation engine allows complete end-to-end dry runs without consuming live telephony credits.
   - Generates deterministic conversational transcripts across diverse root causes (`RAW_MATERIAL_SHORTAGE`, `LOGISTICS_PORT_CONGESTION`, `QUALITY_CONTROL_HOLD`, `PRODUCTION_HALT`, etc.).

3. **FastAPI REST API & Batch Dispatch Service (`src/server.py`):**
   - Endpoints for health checks, call listings, filtering, single-call triggering, batch workflow dispatch, and CSV/JSON export.
   - SQLite relational persistence layer (`src/database.py`) with WAL mode.

4. **Model Context Protocol (MCP) Server (`src/mcp_server.py`):**
   - JSON-RPC stdio server exposing `calle_check_supplier_status` and `calle_run_batch_procurement` tools to AI agents.

5. **Automated Test Suite (`tests/`):**
   - 54 unit and integration tests covering models, transcript parsing, SQLite persistence, REST endpoints, and MCP protocols.

---

## Quickstart: Running the Reference Application

### 1. Offline Simulation Mode (No Account or Credits Required)

Execute the complete 5-step conversational inquiry across suppliers offline:

```bash
python3 main.py --mock --data data/suppliers_enterprise_50.json --output-dir output/
```

This generates:
- `output/procurement_status_report.csv`: ERP-ready tabular status report with masked phone numbers.
- `output/procurement_status_report.json`: Structured JSON audit ledger.
- `output/procurement_dashboard.html`: Self-contained interactive operations web dashboard.

### 2. Launching the Interactive Web Dashboard

Launch the local FastAPI server to view and interact with the operational dashboard:

```bash
python3 main.py --web --port 8000
```

Open `http://localhost:8000` in any browser to inspect orders, view conversational dialogue bubbles, and trigger simulated or live calls.

### 3. Running Automated Tests

Verify test suite passing with 100% success rate:

```bash
python3 -m unittest discover -s tests
```

### 4. Live Telephony Execution (Requires Operator Authorization & Key)

To execute a live outbound call to an authorized supplier contact:

```bash
export CALLE_API_KEY="your-calle-api-key"
python3 main.py --live --supplier SUP-101 --company-name "Global Enterprise Procurement"
```
