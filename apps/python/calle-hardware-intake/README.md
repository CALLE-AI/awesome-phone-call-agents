# CALL-E Hardware Support Intake Agent

Voice AI intake agent for technical-support desks and hardware repair shops.
CALL-E owns the phone call (plan → dial → converse → structured result); a
FastAPI backend drives CALL-E via its CLI/MCP and uses **Gemini function
calling** to turn each conversation into a structured repair ticket, a
diagnostic appointment, or a status lookup — persisted in SQLite and exposed
over a small API.

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

# 3. Gemini key
cp .env.example .env                      # paste GEMINI_API_KEY
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
| POST | `/api/intake` | `{"transcript": "..."}` → Gemini parses, logs a ticket |
| GET  | `/api/tickets` | list tickets |
| GET  | `/api/tickets/{id}` | one ticket |
| POST | `/api/calls` | `{"phone": "+15551234567", "goal": "..."}` → plan + run a real call |
| GET  | `/api/calls/{id}` | live call status |

## Try it without making a call

```bash
curl -X POST http://127.0.0.1:8000/api/intake \
  -H "Content-Type: application/json" \
  -d '{"transcript": "Customer named Alice says her Dell laptop won't boot after a Windows update. Agreed to drop it off Thursday at 10:30am. Priority urgent."}'
```

`/api/intake` and `/health` never place calls. To check a CALL-E plan without
dialing, run:

```bash
python scripts/test_call.py +15551234567 "Confirm the appointment" --dry-plan
```

## Making a real call (live verification)

```bash
python scripts/test_call.py +15551234567 "Intake a hardware repair request: ask the device, the issue, and urgency"
```

This is the opt-in live path. Run it only when you explicitly want CALL-E to
dial a real phone number.

## Side effects & safety

- **Each outbound call spends one CALL-E credit** and dials a real phone
  number in E.164 format (e.g. `+15551234567`). It may reach voicemail.
- **Use `--dry-plan` or `/api/intake` for a no-call path.** Planning only
  validates the goal and never dials.
- **Credentials:** CALL-E uses OAuth via `calle auth login` (no API key). The
  Gemini key lives in `.env`, which is gitignored — never commit it.
- **Phone numbers:** samples above are fictional reserved numbers. Mask any
  real numbers in transcripts/summaries you share.
- **No recurring jobs:** this app places one-off calls only; there is nothing
  scheduled or recurring to cancel.
- **Boundaries:** CALL-E governs outbound behavior; keep goals to legitimate
  business calls and avoid medical/legal/financial/emergency content.

## Notes

- **IPv4 fix:** `app/netfix.py` forces IPv4 name resolution because the dev
  machine's IPv6 route is broken; harmless elsewhere.
- **Model:** `gemini-flash-latest` (older Gemini models are retired for new
  accounts).
- Tickets live in `calle_agent.db` (SQLite).
