---
name: calle-lead-qualifier
description: Autonomous B2B outbound phone call qualification and sales routing agent powered by CALL-E and Gemini 2.0. Conducts interactive conversational calls, extracts budget, timeline, authority, and pain points, and auto-routes hot leads to Account Executives via Slack and CRM.
author: CALL-E Community Contributor
tags:
  - phone-call-agent
  - lead-qualification
  - sales-routing
  - b2b-saas
  - crm-automation
---

# Lead Qualification & Sales Routing Agent (CALL-E Skill)

An end-to-end autonomous voice agent skill that turns raw prospect lists into qualified sales pipeline using CALL-E's outbound telephony API.

## Real-World Impact
- **Saves 80+ SDR hours/month** by automating cold calls, qualification questions, and initial transcription.
- **Zero-latency routing**: Hot enterprise leads get dispatched to Senior AEs via Slack within seconds of hanging up with a strict 2-hour SLA.
- **Auditable & Compliant**: Full verbal call recordings and transcripts are analyzed for pain points, competitors, and red flags before syncing to SQLite and Google Sheets.

## Architecture & Workflow

```
+------------------+      +-------------------+      +----------------------+
|  Prospect Input  | ---> |   CALL-E Engine   | ---> |  Call Transcript     |
|   (CSV / API)    |      | (Outbound Dialer) |      |   & Voice Dialogue   |
+------------------+      +-------------------+      +----------------------+
                                                                |
                                                                v
+------------------+      +-------------------+      +----------------------+
|  CRM / Sheets /  | <--- |   Router & SLA    | <--- |  Gemini 2.0 Flash    |
|  Slack Alerts    |      |   (Hot/Warm/Cold) |      | (B2B Qualification)  |
+------------------+      +-------------------+      +----------------------+
```

1. **Prospect Ingestion**: Ingests prospect names, roles, phone numbers, and assumed budgets.
2. **Idempotency & Safety**: Computes deterministic hash keys (`lead_{id}_{campaign}`) to strictly prevent accidental double-dialing.
3. **CALL-E Outbound Call**: Dials the prospect using E.164 normalization, initiates interactive conversation, and streams the transcript.
4. **LLM Qualification**: Extracts B2B buying signals using structured JSON:
   - `budget_tier` (`startup` | `mid-market` | `enterprise`)
   - `timeline` (`immediate` | `next_quarter` | `next_year` | `exploratory`)
   - `decision_maker` (`true` | `false` | `unknown`)
   - `pain_points` & `red_flags`
   - `fit_score` (0.00 - 1.00) & `overall_tier` (`hot` | `warm` | `cold`)
5. **Intelligent Sales Routing**:
   - **Hot Leads (Fit > 80% / Immediate Timeline)**: Routed to Senior AE with 2-hour SLA and Slack alert.
   - **Warm Leads (Fit 50-80% / Q3-Q4 Timeline)**: Routed to Mid-Market AE with case study followup.
   - **Cold / Disqualified**: Automatically added to email nurture flow.
6. **Durable Persistence**: Logs results to SQLite with full JSON history and optionally syncs rows to Google Sheets.

## Configuration & Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `CALLE_API_KEY` | CALL-E Bearer API token | Required for live calling |
| `CALLE_BASE_URL` | CALL-E API Endpoint | `https://api.heycall-e.com` |
| `GEMINI_API_KEY` | Google Gemini 2.0 API Key | Optional (falls back to Ollama or rule engine) |
| `DRY_RUN` | Simulation mode for local demo testing | `True` |
| `SLACK_WEBHOOK_URL` | Webhook for sales team notifications | Optional |
| `GOOGLE_SHEET_ID` | Google Sheet ID for spreadsheet sync | Optional |
| `GOOGLE_TOKEN` | OAuth Bearer token for Google Sheets API | Optional |

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Run full test suite
python3 -m pytest

# Start web command center
PORT=3000 python3 app.py
```

Open `http://localhost:3000` to launch the dashboard, trigger demo calls, or place a live call to your own test number!
