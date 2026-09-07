# CivicScout: Autonomous Public Works Voice Agent 🏙️📞

> Built for the **CALL-E: Your Code Is Calling** Hackathon.  
> Scalable, Multi-Agent Voice Orchestration for Municipal 311 Services.

[![Tests](https://img.shields.io/badge/tests-7%20passed-brightgreen.svg)]()
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)]()
[![FastMCP](https://img.shields.io/badge/FastMCP-4.0.1-blue.svg)]()
[![Google Cloud Run](https://img.shields.io/badge/Google%20Cloud-Run-4285F4.svg)]()
[![Firestore](https://img.shields.io/badge/Database-Firestore-FFCA28.svg)]()

---

## 📌 Problem Statement & Overview

Municipal public works departments receive thousands of 311 citizen reports daily regarding water leaks, sinkholes, fallen trees, and traffic signal failures. Most reports lack critical context:
- Is the water leak an isolated meter drip or a high-pressure ruptured main?
- Is the fallen tree touching energized 12kV power lines?
- What is the gate code for rapid utility truck entry?

**CivicScout** bridges this gap by acting as an autonomous proactive phone agent. It reads pending tickets from **Google Cloud Firestore**, dials the citizen or superintendent using **CALL-E**, validates contractor authorization codes mid-call via **FastMCP**, extracts structured actionable JSON data upon call completion, and **dynamically provisions secondary agents** when inter-departmental emergency escalations are triggered.

---

## 🏗️ Architecture & Orchestration

```
+-------------------------------------------------------------------------------+
|                           CIVICSCOUT ARCHITECTURE                             |
+-------------------------------------------------------------------------------+
|                                                                               |
|   [ 311 Ticket Ingestion ]  ----->  [ Google Cloud Firestore ]                |
|                                                  |                            |
|                                       (Pending Work Orders)                   |
|                                                  v                            |
|                                    [ Multi-Agent Orchestrator ]               |
|                                                  |                            |
|                                       (1. Outbound Voice Dial)                |
|                                                  v                            |
|                                      [ CALL-E Primary Agent ]                 |
|                                         (Roads / Forestry)                    |
|                                                  |                            |
|                         +------------------------+------------------------+   |
|                         |                                                 |   |
|            [ 2. Mid-Call FastMCP Tools ]                        [ 3. Webhook ]|
|            - query_authorization_code()                         Structured    |
|            - update_ticket_status_midcall()                     JSON Result   |
|            - trigger_department_escalation()                              |   |
|                         |                                                 v   |
|                         +-------------------------------------------------+   |
|                                                  |                            |
|                                  (Emergency Escalation Condition)             |
|                                                  v                            |
|                                     [ CALL-E Secondary Agent ]                |
|                             (Emergency Utility & Multi-Agency Dispatch)       |
|                                                  |                            |
|                                       (4. Final State Update)                 |
|                                                  v                            |
|                                     [ Google Cloud Firestore ]                |
|                                    (Status: ESCALATED / DISPATCHED)           |
|                                                                               |
+-------------------------------------------------------------------------------+
```

---

## 🛠️ MCP Tools Exposed to CALL-E Agent

1. **`query_authorization_code(ticket_id, auth_code)`**: Checks municipal contractor permit against city database.
2. **`update_ticket_status_midcall(ticket_id, status, notes, severity)`**: Enables the agent to alter ticket state and field notes mid-conversation.
3. **`trigger_department_escalation(ticket_id, source_dept, target_dept, reason, urgency_level)`**: Automatically initiates multi-agency transfer.
4. **`lookup_ticket_details(ticket_id)`**: Queries current ticket data and reporter history.

---

## 🚦 Quickstart & Verification

### 1. Run Automated Test Suite
```bash
pytest -v tests/test_end_to_end.py
```

### 2. Run Interactive CLI Demonstration
```bash
python demo_cli.py
```

### 3. Start Local Cloud Run Server
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8080
```
- API Documentation: [http://localhost:8080/docs](http://localhost:8080/docs)
- Health Check: [http://localhost:8080/health](http://localhost:8080/health)
- FastMCP Server: [http://localhost:8080/mcp](http://localhost:8080/mcp)

---

## 📂 Repository Structure

```
├── app/
│   ├── __init__.py          # Package initialization
│   ├── config.py            # Pydantic configuration & env loading
│   ├── models.py            # Pydantic schemas (Tickets, Results, MCP tools)
│   ├── database.py          # Google Cloud Firestore manager & mock engine
│   ├── mcp_server.py        # FastMCP server & registered tool implementations
│   ├── calle_client.py      # CALL-E SDK client & prompt builder
│   ├── orchestrator.py      # Multi-agent loop & dynamic escalation handler
│   └── main.py              # FastAPI application on Google Cloud Run
├── tests/
│   └── test_end_to_end.py   # Complete automated end-to-end test suite
├── submission/
│   ├── README.md            # Pull Request README for awesome-phone-call-agents
│   ├── DEVPOST_STORY.md     # Complete Devpost Hackathon Story in Markdown
│   └── VIDEO_STORYBOARD_AND_SCRIPT.md # 3-Minute YouTube Video Plan & Script
├── Dockerfile               # Google Cloud Run production container
├── cloudbuild.yaml          # Google Cloud Build deployment pipeline
├── deploy.sh                # Deployment shell script
├── demo_cli.py              # Rich CLI live demonstration runner
├── requirements.txt         # Project dependencies
└── pytest.ini               # Pytest configuration
```
