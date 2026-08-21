# CALL-E Hardware Support Intake Agent

Voice AI intake agent for technical-support desks and hardware repair shops,
built for the **CALL-E: Your Code Is Calling** hackathon.

CALL-E owns the phone call (plan → dial → converse → structured result); a
FastAPI backend drives CALL-E and uses **Gemini function calling** to turn each
conversation into a structured repair ticket, a diagnostic appointment, or a
status lookup — persisted in SQLite and exposed over a small API.

## Architecture

```
[ Your phone ]  ←  CALL-E dials/converses  →  [ calle CLI / MCP ]
                                                  │
                        plan_call → run_call → get_call_run
                                                  │
                                        [ FastAPI backend ]
                                                  │
                                          ┌───────┴────────┐
                                          ▼                ▼
                                   [ Gemini API ]    [ SQLite (tickets) ]
                                   intent parsing     + call sessions
                                   + tool calling
```

## Setup

```bash
# 1. Python env + deps (uv recommended)
uv venv .venv --python 3.11
source .venv/Scripts/activate            # PowerShell: .venv\Scripts\Activate.ps1
uv pip install -r requirements.txt

# 2. CALL-E CLI (Node.js) + auth — OAuth, NOT an API key
npm install -g @call-e/cli
calle auth login                          # opens browser, approve

# 3. Keys
cp .env.example .env                      # paste GEMINI_API_KEY; set API_KEY
```

## Run

```bash
uvicorn app.main:app --reload
```

Then open http://127.0.0.1:8000/docs (auto-generated Swagger UI).

### API

| Method | Path | Purpose |
|---|---|---|
| GET  | `/health` | server + CALL-E auth status |
| POST | `/api/intake` | `{"transcript": "..."}` → Gemini parses, logs a ticket (no call) |
| GET  | `/api/tickets` | list tickets |
| GET  | `/api/tickets/{id}` | one ticket |
| POST | `/api/calls` | 🔒 `X-API-Key` · `{"phone":"+15551234567","goal":"...","idempotency_key":"..."}` → **plans only, never dials** |
| POST | `/api/calls/{id}/run` | 🔒 `X-API-Key` · explicit confirmation that **executes** a planned call |
| GET  | `/api/calls/{id}` | live call status |

**Live-call auth:** planning (`POST /api/calls`) and executing (`POST
/api/calls/{id}/run`) require the `X-API-Key` header set to your `API_KEY` env
var. These endpoints fail closed (`503`) when `API_KEY` is empty.

### Try it without a call

```bash
curl -X POST http://127.0.0.1:8000/api/intake \
  -H "Content-Type: application/json" \
  -d '{"transcript": "Customer named Alice says her Dell laptop won't boot after a Windows update. Agreed to drop it off Thursday at 10:30am. Priority urgent."}'
```

### Make a real call (uses a CALL-E credit)

Via the script (plans + runs + logs a ticket):
```bash
python scripts/test_call.py +15551234567 "Confirm the 10:30am laptop diagnostic appointment"
# add --dry-plan to only plan without dialing
```

Via the API — **two-step, so a call is never placed without confirmation**:
```bash
# 1. Plan (never dials)
curl -X POST http://127.0.0.1:8000/api/calls -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"phone":"+15551234567","goal":"Confirm the appointment","idempotency_key":"call-1"}'
# -> returns {"id":1,"status":"planned",...}

# 2. Explicitly execute
curl -X POST http://127.0.0.1:8000/api/calls/1/run -H "X-API-Key: $API_KEY"
```

## Notes

- **IPv4 fix:** `app/netfix.py` forces IPv4 name resolution because the dev
  machine's IPv6 route is broken; harmless elsewhere.
- **Model:** `gemini-flash-latest` (older Gemini models are retired for new accounts).
- Tickets live in `calle_agent.db` (SQLite). Never commit `.env`.

## Submission (awesome-phone-call-agents)

The `templates/agent_skills/SKILL.md` is the Agent-Skill layout for the PR.
Adapt this app into `apps/python/` of the
[awesome-phone-call-agents](https://github.com/CALLE-AI/awesome-phone-call-agents)
repo, then open the PR and link it on Devpost with the demo video.
