# OnTripFix 🆘📞

**Autonomous Apache Airflow Incident Remediation with Call-E Voice AI & LangGraph StateGraph**

`ontripfix` is a production-grade demonstration app that solves a critical on-call operational challenge: automated incident response for data pipelines failing outside regular office hours.

When a batch ETL pipeline fails in Apache Airflow, **OnTripFix** intercepts the failure, enriches the incident context using Jira and Confluence, places an outbound voice call to the on-call engineer using **Call-E Voice AI**, collects remediation approval, and executes schema fixes automatically using a **LangGraph StateGraph** powered by Google Gemini tools.

---

## 🎯 Key Features & Workflow Architecture

```text
┌───────────────────────────┐
│ Apache Airflow DAG        │ (Friday Night ETL Pipeline)
│ transform_inventory_sql   │ ❌ SQL Failure (Missing Column 'inventory_status')
└─────────────┬─────────────┘
              │ on_failure_callback
              ▼
┌───────────────────────────┐
│ Flask Webhook Server      │ HTTP POST /api/airflow-failure-webhook
│ (Port 7071)               │
└─────────────┬─────────────┘
              │ Enqueue Payload
              ▼
┌───────────────────────────┐
│ Error Queue & Worker      │ 1. Jira REST API Search (or RETAIL-4021 fallback)
│ (Background Thread)       │ 2. Confluence Playbook Lookup (or playbook.json fallback)
│                           │ 3. Confluence On-Call Calendar (Alex Morgan: +1-555-0199)
└─────────────┬─────────────┘
              │ Result Schema
              ▼
┌───────────────────────────┐
│ Call-E Outbound Voice AI  │ 📞 Call On-Call Engineer via Call-E API
│ (docs.heycall-e.com/calls)│ 🗣️ Present Incident + Jira Match + Suggested SQL Fix
└─────────────┬─────────────┘
              │ Approved Resolution Instructions
              ▼
┌───────────────────────────┐
│ Resolution Queue & Worker │ Enqueue Resolution Payload
└─────────────┬─────────────┘
              │ Invoke LangGraph
              ▼
┌───────────────────────────┐
│ LangGraph StateGraph Engine│ Node 1: parse_instructions
│ (Gemini 2.5 Flash Tools)  │ Node 2: execute_sql (ALTER TABLE on SQLite DB)
│                           │ Node 3: trigger_airflow (DAG task retry)
│                           │ Node 4: validate_data (Row count & metrics validation)
└─────────────┬─────────────┘
              │ Validation Result
              ▼
┌───────────────────────────┐
│ Call-E Post-Validation    │ ✅ SUCCESS: Confirmation voice call to engineer
│ Follow-up Call            │ ❌ FAILURE: Alert voice call with Zoom Incident Bridge URL
└───────────────────────────┘
```

---

## 📁 Repository Structure

```text
apps/python/ontripfix/
├── README.md                          # Application documentation
├── simulate_e2e_incident.py           # End-to-end incident response simulation script
├── requirements.txt                   # Production dependencies
├── project-requirements.txt           # Detailed dependency manifest
├── config/
│   ├── oncall_config.json.example     # Sample on-call roster fallback configuration
│   ├── en_in_oncall_config.json.example # India EN regional roster template
│   ├── hi_in_oncall_config.json.example # India HI regional roster template
│   └── ta_in_oncall_config.json.example # India TA regional roster template
├── dags/
│   └── retail_Friday_inventory_etl.py # Airflow DAG with on_failure_callback
├── db/
│   ├── init_sqlite.py                 # SQLite schema initialization script
│   └── retail_data.db                 # SQLite database storage
├── flask_app/
│   └── app.py                         # Flask incident server & webhook endpoint
├── playbook/
│   └── playbook.json                  # Local runbook pattern matching rules
├── services/
│   ├── error_queue_worker.py          # Error Queue consumer & telemetry enrichment
│   ├── resolution_queue_worker.py     # Resolution Queue consumer & LangGraph dispatch
│   ├── calle_voice_service.py         # Call-E Voice AI integration client
│   ├── jira_service.py                # Jira API search integration with fallback
│   ├── confluence_service.py          # Confluence Playbook & Calendar service
│   ├── langgraph_remediation.py       # LangGraph StateGraph & Gemini tools engine
│   ├── remediation_queue.py           # Database execution and ETL validation queue
│   └── playbook_service.py            # Playbook pattern matching helper
└── tests/
    └── test_flow.py                   # Pytest test suite for end-to-end pipeline
```

---

## 🚀 Quick Start & Setup

### Prerequisites

- **Python 3.10+** (Python 3.13 tested)
- `pip` package manager

### 1. Create and Activate Virtual Environment

```bash
python3 -m venv venv
source venv/bin/activate
```

### 2. Install Dependencies

```bash
pip install -r apps/python/ontripfix/requirements.txt
```

---

## 💻 How to Run the Application

### Option A: Run Full End-to-End Simulation (Recommended)

Run the automated simulation script to execute all four phases in sequence:

```bash
python apps/python/ontripfix/simulate_e2e_incident.py
```

#### What happens during simulation:
1. **Phase 1 (Database Init)**: Resets `retail_data.db` to a fresh state with a missing `inventory_status` column in `daily_store_inventory_agg`.
2. **Phase 2 (Flask Server & Queues)**: Launches the background Flask server on port `7071` with active `Error Queue` and `Resolution Queue` worker threads.
3. **Phase 3 (Airflow DAG Failure & Call-E AI Call)**: Executes `retail_Friday_inventory_etl`. The SQL task fails, `on_failure_callback` posts failure context to the Flask webhook, Jira/Confluence context is fetched, Call-E places an outbound voice call to Alex Morgan (+1-555-0199), and approved fix instructions are queued.
4. **Phase 4 (LangGraph Auto-Remediation & DAG Re-run)**: LangGraph StateGraph applies `ALTER TABLE daily_store_inventory_agg ADD COLUMN inventory_status TEXT DEFAULT 'OK';`, re-executes the Airflow DAG task, verifies that 4 store records ($93,292.00 total sales) are aggregated, and triggers a Call-E confirmation call.

---

### Option B: Run Pytest Test Suite

Run the full automated test suite:

```bash
pytest apps/python/ontripfix/tests/test_flow.py
```

---

### Option C: Run Flask Incident Remediation Server Standalone

Start the Flask webhook server on port `7071`:

```bash
python ./apps/python/ontripfix/fastapi_app/app.py
```

Run with live auto-reload enabled:

```bash
python -m uvicorn fastapi_app.app:app --host 0.0.0.0 --port 7071
```

**Health Check Endpoint:**
```bash
curl http://localhost:7071/api/health
```

**Post Airflow Failure Webhook Payload:**
```bash
curl -X POST http://localhost:7071/api/airflow-failure-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "dag_id": "retail_Friday_inventory_etl",
    "task_id": "transform_inventory_sql",
    "execution_date": "2026-09-06T22:00:00",
    "error_message": "sqlite3.OperationalError: table daily_store_inventory_agg has no column named inventory_status"
  }'
```

---

## ⚙️ Environment Variables & Credentials

The application works out-of-the-box using local fallback mechanisms (mock voice responses, local SQLite, fallback Jira tickets, and local roster config). To connect to live services, set the following environment variables:

| Environment Variable | Service | Purpose | Fallback Behavior |
| --- | --- | --- | --- |
| `CALLE_API_ENDPOINT` | Call-E Voice AI | Voice API endpoint URL | Default: `https://docs.heycall-e.com/calls` |
| `CALLE_API_KEY` | Call-E Voice AI | Bearer token for Call-E outbound API | Simulated voice call output |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | Google Gemini | API key for `ChatGoogleGenerativeAI` | LangGraph deterministic tool execution |
| `FLASK_WEBHOOK_URL` | Flask Server | Target URL for Airflow failure callback | Default: `http://localhost:7071/api/airflow-failure-webhook` |
| `JIRA_URL` | Atlassian Jira | Jira instance base URL | Fallback ticket `RETAIL-4021` |
| `JIRA_USER_EMAIL` | Atlassian Jira | User email for Jira REST API authentication | Local fallback data |
| `JIRA_API_TOKEN` | Atlassian Jira | API token for Jira REST API authentication | Local fallback data |
| `CONFLUENCE_PLAYBOOK_URL` | Confluence | URL to Confluence runbook page | Local `playbook/playbook.json` |
| `CONFLUENCE_CALENDAR_URL` | Confluence | URL to Confluence Team Calendar API | Local `config/oncall_config.json` (or `.example`) |
| `CONFLUENCE_USER_EMAIL` | Confluence | User email for Confluence API authentication | Local fallback data |
| `CONFLUENCE_API_TOKEN` | Confluence | API token for Confluence API authentication | Local fallback data |

---

## 🛡️ Safety, Side Effects & Rollback

- **No Live Telephony Cost by Default**: Pre-configured with simulated voice interactions and E.164 test numbers (`+1-555-0199`). Phone numbers in log outputs are sanitized.
- **Controlled Database Side Effects**: All database modifications target local SQLite instance (`db/retail_data.db`).
- **Database Reset / Rollback**: Reset schema and seed data to initial state at any time by running:
  ```bash
  python apps/python/ontripfix/db/init_sqlite.py
  ```
