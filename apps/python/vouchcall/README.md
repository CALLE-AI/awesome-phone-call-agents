# VouchCall — AI-Powered Reference Checker

VouchCall automates professional reference checking for hiring. It uses CALL-E to conduct structured phone interviews with candidate references, Gemini to analyze transcripts and score traits, and a Streamlit dashboard to compare references and flag discrepancies.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        VouchCall Pipeline                       │
└─────────────────────────────────────────────────────────────────┘

  ┌──────────┐       ┌──────────────┐       ┌──────────────────┐
  │ Recruiter│       │   agent.py   │       │     CALL-E       │
  │ runs     │──────▶│  Orchestrator│──────▶│  AI Phone Calls  │
  │ agent.py │       │              │       │                  │
  └──────────┘       └──────┬───────┘       └────────┬─────────┘
                            │                        │
                            │                  Transcript +
                            │                  Call Summary
                            │                        │
                            ▼                        ▼
                    ┌──────────────┐       ┌──────────────────┐
                    │   store.py   │◀──────│     llm.py       │
                    │   SQLite DB  │       │  Gemini 3.5 Flash│
                    │              │       │                  │
                    │ • candidates │       │ • Per-call       │
                    │ • references │       │   scoring (1-10) │
                    │ • call data  │       │ • Strengths &    │
                    │ • analysis   │       │   growth areas   │
                    └──────┬───────┘       │ • Cross-reference│
                           │               │   discrepancies  │
                           │               └──────────────────┘
                           ▼
                    ┌──────────────┐
                    │ dashboard.py │
                    │  Streamlit   │
                    │              │
                    │ • Radar chart│
                    │ • Scores     │
                    │ • Quotes     │
                    │ • Flags      │
                    └──────────────┘
```

### Data Flow

```
Reference 1 ──┐                    ┌── Scores (5 dimensions)
               │   CALL-E call     │
Reference 2 ──┼─▶ Transcript ──▶  Gemini  ──┼── Strengths / Growth Areas
               │   per reference   │         │
Reference 3 ──┘                    │         └── Key Quotes
                                   ▼
                            Cross-Reference
                              Analysis
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
              Discrepancies   Hire/No-Hire   Confidence %
              (with severity)  Recommendation   Score
```

## How It Works

1. **Add a candidate** with their references (name, phone, relationship)
2. **CALL-E calls each reference** and conducts a structured interview — asking about strengths, teamwork, reliability, growth areas, and a 1-10 recommendation
3. **Gemini analyzes each transcript** and extracts scores across 5 dimensions (collaboration, technical ability, reliability, communication, leadership), plus strengths, growth areas, and key quotes
4. **Cross-reference analysis** compares all references against each other, flagging discrepancies (e.g., one reference rates reliability 9/10 while another rates it 5/10)
5. **Dashboard** shows a radar chart comparison, per-reference details, and a final hire recommendation with confidence score

## Setup

### Prerequisites

- Python 3.10+
- A [CALL-E](https://dashboard.heycall-e.com) API key
- A [Google AI Studio](https://aistudio.google.com) API key (free tier works)

### Install

```bash
cd apps/python/vouchcall
python -m venv .venv
.venv/Scripts/activate   # Windows
# source .venv/bin/activate  # macOS/Linux
pip install -r requirements.txt
```

### Configure

Copy `.env.example` to `.env` and fill in your keys:

```
CALLE_API_KEY=your_calle_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here
TEST_PHONE=+1234567890
```

### Credentials

| Variable | Source | Required |
|---|---|---|
| `CALLE_API_KEY` | [CALL-E Dashboard](https://dashboard.heycall-e.com) → API Keys | Yes |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) | Yes |
| `TEST_PHONE` | Your phone number for testing | For tests only |

## Usage

### Demo Mode (no phone calls)

```bash
python seed_data.py
streamlit run dashboard.py
```

Seeds the database with 3 demo candidates using realistic reference transcripts, runs Gemini analysis on each, performs cross-reference comparison, and launches the dashboard. Uses Gemini API calls but zero CALL-E credits.

### Live Calls

```bash
python agent.py <candidate_id>
```

This calls each reference via CALL-E, analyzes results with Gemini, and stores everything in the database. Each reference uses 1 CALL-E credit.

```bash
python agent.py <candidate_id> --dry-run
```

Shows what would happen without placing calls.

### Dashboard

```bash
streamlit run dashboard.py
```

Opens the reference comparison dashboard with radar chart, per-reference details, and cross-reference analysis.

## Side Effects

- **Phone calls**: `agent.py` (without `--dry-run`) places real phone calls via CALL-E. Each call costs 1 CALL-E credit.
- **Gemini API**: `seed_data.py` and `agent.py` make Gemini API calls for transcript analysis. Free tier has daily limits.
- **SQLite database**: Creates `vouchcall.db` in the project directory.

## Cancellation

- CALL-E calls can be interrupted by the recipient hanging up.
- `Ctrl+C` during `agent.py` stops further calls (already-placed calls complete on CALL-E's side).
- No subscriptions or recurring charges — CALL-E and Gemini are pay-per-use.

## Project Structure

```
vouchcall/
├── agent.py          # Main orchestrator — calls references and analyzes results
├── calle_wrapper.py  # Thin wrapper around CALL-E SDK
├── config.py         # Environment config and constants
├── dashboard.py      # Streamlit dashboard with radar chart and discrepancy view
├── llm.py            # Gemini integration for transcript analysis
├── prompts.py        # CALL-E conversation goal builder
├── seed_data.py      # Demo data seeder with realistic transcripts
├── store.py          # SQLite storage layer
├── requirements.txt  # Python dependencies
├── .env.example      # Environment variable template
└── tests/            # Test scripts (gitignored)
```

## Production Roadmap

This hackathon prototype proves the pipeline works end-to-end. Here's how VouchCall becomes a real product:

### Phase 1 — CLI Tool (current)
- Recruiter runs `agent.py` on their machine or a shared VM
- Dashboard served locally or on an internal server
- SQLite for storage, manual candidate setup via `seed_data.py` or direct DB inserts

### Phase 2 — Web App
- Deploy as a hosted web app (FastAPI backend + Streamlit or React frontend)
- Recruiter logs in, adds candidates and references through a form
- Clicks "Start Reference Check" — CALL-E calls run in the background
- Dashboard updates automatically as calls complete and Gemini analyzes transcripts
- Deploy on Streamlit Cloud, Railway, or AWS for quick iteration

### Phase 3 — ATS Integration
- Integrate with Greenhouse, Lever, Workday via their APIs
- When a candidate reaches the "reference check" stage, VouchCall auto-triggers
- Results flow back into the ATS as a structured report
- Hiring managers see radar charts and discrepancy flags inline, no separate tool needed

### Infrastructure for Production
- **Database**: SQLite → PostgreSQL for concurrent access and durability
- **Async processing**: Task queue (Celery + Redis) so calls don't block the web server
- **Auth**: SSO / OAuth so only authorized recruiters access results
- **Compliance**: Store call recordings and transcripts with retention policies
- **Monitoring**: Track call success rates, Gemini latency, and cost per reference check

## Tech Stack

- **CALL-E** — AI phone calls
- **Gemini 3.5 Flash** — Transcript analysis and cross-reference comparison
- **Streamlit** — Dashboard UI
- **Plotly** — Radar chart visualization
- **SQLite** — Local data storage
