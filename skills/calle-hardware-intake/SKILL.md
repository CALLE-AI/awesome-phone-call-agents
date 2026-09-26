---
name: calle-hardware-intake
description: Log hardware/tech-support repair tickets from phone calls via CALL-E + Gemini
metadata:
  type: agent-skill
  call-e-integration: MCP
---

# CALL-E Hardware Support Intake

A phone-call intake agent for repair shops: CALL-E places/receives calls, a
FastAPI backend drives the call through `plan_call` → `run_call` →
`get_call_run`, and Gemini parses the conversation to log structured repair
tickets and schedule diagnostic slots into SQLite.

## Requirements

- `calle` CLI installed and authenticated (`calle auth login`)
- Gemini API key in `.env` (`GEMINI_API_KEY`)
- Python 3.10+, FastAPI, SQLAlchemy (see repo `requirements.txt`)

## Install

```bash
uv venv .venv --python 3.11 && source .venv/Scripts/activate
uv pip install -r requirements.txt
cp .env.example .env   # add GEMINI_API_KEY
```

## Run

```bash
uvicorn app.main:app --reload
```

- `POST /api/calls` `{"phone": "+15551234567", "goal": "..."}` — plan + run a call
- `GET  /api/calls/{id}` — live call status
- `GET  /api/tickets` — logged tickets
- `POST /api/intake` `{"transcript": "..."}` — parse a transcript into a ticket

## Notes

- CALL-E uses OAuth (not an API key): `calle auth login` once.
- This repo forces IPv4 in Python because the dev machine's IPv6 route is broken
  (`app/netfix.py`) — harmless elsewhere.
- Tickets are stored in `calle_agent.db` (SQLite).
