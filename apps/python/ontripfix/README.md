# OnTripFix 🆘📞

**Autonomous Apache Airflow Incident Remediation with Call-E Voice AI & LangGraph StateGraph**

`ontripfix` is a reference demonstration application that illustrates an automated on-call incident response workflow for data pipelines failing outside regular office hours.

When a batch ETL pipeline fails in Apache Airflow, **OnTripFix** intercepts the failure, enriches the incident context using Jira and Confluence, simulates or dispatches a bounded voice call to the on-call engineer using **Call-E Voice AI**, collects remediation approval, and executes schema fixes automatically using a **LangGraph StateGraph** powered by Google Gemini tools.

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

The application works out-of-the-box in safe local fake-only sandbox mode (simulated voice responses, local SQLite, fallback Jira tickets, and fictional roster configurations). To connect to live external services, set the following environment variables:

| Environment Variable | Service | Purpose | Fallback / Default Behavior |
| --- | --- | --- | --- |
| `ENABLE_OUTBOUND_CALLS` | Call-E Voice AI | Enable live telephony outbound calls | Default: `false` (local fake-only sandbox) |
| `CALLE_API_ENDPOINT` | Call-E Voice AI | Voice API endpoint URL (must be HTTPS) | Default: `https://api.heycall-e.com/v1/calls` |
| `CALLE_API_KEY` | Call-E Voice AI | Bearer token for Call-E outbound API | Simulated voice call output |
| `AUTHORIZED_RECIPIENT_PHONES` | Call-E Voice AI | Comma-separated list of authorized ASCII E.164 numbers | Permits fictional `+15550100`–`+15550199` |
| `APPROVED_CALLE_DOMAINS` | Call-E Voice AI | Additional approved hostnames for Call-E | Defaults to `api.heycall-e.com`, `docs.heycall-e.com` |
| `ONTRIPFIX_WEBHOOK_SECRET` | FastAPI Server | Shared secret token for trigger endpoints | Optional; unauthenticated in local sandbox |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | Google Gemini | API key for `ChatGoogleGenerativeAI` | LangGraph deterministic tool execution |
| `FLASK_WEBHOOK_URL` | Airflow Callback | Target URL for Airflow failure callback | Default: `http://localhost:7071/api/airflow-failure-webhook` |
| `JIRA_URL` | Atlassian Jira | Jira instance base URL | Fallback ticket `RETAIL-4021` |
| `JIRA_USER_EMAIL` | Atlassian Jira | User email for Jira REST API authentication | Local fallback data |
| `JIRA_API_TOKEN` | Atlassian Jira | API token for Jira REST API authentication | Local fallback data |
| `CONFLUENCE_PLAYBOOK_URL` | Confluence | URL to Confluence runbook page | Local `playbook/playbook.json` |
| `CONFLUENCE_CALENDAR_URL` | Confluence | URL to Confluence Team Calendar API | Local `config/oncall_config.json.example` |
| `CONFLUENCE_USER_EMAIL` | Confluence | User email for Confluence API authentication | Local fallback data |
| `CONFLUENCE_API_TOKEN` | Confluence | API token for Confluence API authentication | Local fallback data |

---

## 🛡️ Safety, Demo Boundaries & Cancellation Limits

- **Default to No-Call (Local Fake-Only Sandbox)**: Outbound calls are disabled by default (`ENABLE_OUTBOUND_CALLS=false`). The app runs in a local simulation mode using fictional test fixtures (`Alex Morgan`, `+15550199`). Real phone calls cannot be placed without explicit user intent and environment configuration.
- **Strict ASCII E.164 Whitelist**: All recipient phone numbers are validated against strict ASCII E.164 regex format (`+[1-9]\d{6,14}`). Non-ASCII digits and unapproved numbers are rejected before any call dispatch.
- **Approved HTTPS Origins & Redirect Rejection**: Call-E API calls are strictly restricted to approved HTTPS origins (`https://api.heycall-e.com`). All HTTP redirects (3xx) are rejected (`allow_redirects=False`) to prevent credential leakage.
- **Bound Approval & Stopping Unknown Outcomes**: Automatic remediation requires explicit bound approval and employee User ID validation (`approved="yes"` and `user_id_validated=True`). If a call times out, fails, or is rejected, approval is NEVER fabricated: remediation is immediately halted, Jira is updated with an escalation alert, and no SQL changes or follow-up calls are triggered.
- **Cancellation & Single-Run Semantics**: Outbound voice calls are strictly single-run requests governed by API timeouts (120–300 seconds). There are no hidden recurring schedules, background redial loops, or duplicate jobs.
- **Public Display Masking**: All public endpoints (`/api/roster`, `/api/dashboard/stats`, `/api/incidents`, `/api/queues`, `/api/logs`) mask telephone numbers (`+1••••••0199`) and sanitize email addresses and employee IDs.
- **Controlled Database Side Effects**: All SQL fixes operate exclusively on the local SQLite instance (`db/retail_data.db`). Reset schema and seed data to the initial state at any time by running:
  ```bash
  python apps/python/ontripfix/db/init_sqlite.py
  ```
