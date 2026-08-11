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
2. **CALL-E calls each reference** — first verifies recipient identity, then conducts a structured interview asking about strengths, teamwork, reliability, growth areas, and a 1-10 recommendation
3. **Gemini analyzes each transcript** and extracts scores across 5 dimensions (collaboration, technical ability, reliability, communication, leadership), plus strengths, growth areas, and key quotes
4. **LLM guardrails validate every output** — scores are clamped to 1-10, key quotes are fuzzy-matched against the actual transcript (fabricated quotes are dropped), score-recommendation coherence is enforced, and confidence is calculated from inter-reference variance rather than trusting the LLM's self-assessment
5. **Cross-reference analysis** compares all references against each other, flagging discrepancies (e.g., one reference rates reliability 9/10 while another rates it 5/10)
6. **Dashboard** shows a radar chart comparison, per-reference details, and a final hire recommendation with confidence score

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

### Demo Mode (no phone calls, no API keys needed)

```bash
python seed_data.py
streamlit run dashboard.py
```

Seeds the database with 3 demo candidates using hardcoded reference data and launches the dashboard. Zero API keys needed, zero credits used.

To re-analyze Alex Morgan's transcripts with live Gemini (requires `GEMINI_API_KEY`):

```bash
python seed_data.py --gemini
```

### Dry Run (default, no API keys needed)

```bash
python agent.py <candidate_id>
```

Previews the call goals and reference list without placing any calls or using API credits.

### Live Calls

```bash
python agent.py <candidate_id> --live
```

Places real CALL-E calls to each reference, analyzes results with Gemini, and stores everything in the database. Requires `CALLE_API_KEY` and `GEMINI_API_KEY`. Each reference uses 1 CALL-E credit.

### Dashboard

```bash
streamlit run dashboard.py
```

Opens the reference comparison dashboard with radar chart, per-reference details, and cross-reference analysis.

## Safety & Guardrails

- **Safe by default**: `agent.py` runs in dry-run mode. Real calls require the explicit `--live` flag and valid API keys.
- **Recipient verification**: The AI verifies the recipient's identity before disclosing any candidate or role details.
- **E.164 phone validation**: Phone numbers are validated before any call is placed. Invalid numbers are skipped.
- **Idempotency**: Re-running `agent.py --live` skips references that already have a completed call on record.
- **Phone masking**: All console output shows masked phone numbers (e.g., `********1234`).
- **LLM output validation**: Scores are clamped 1-10, recommendations are enum-constrained, key quotes are verified against the transcript via fuzzy matching, score-recommendation contradictions are auto-corrected, and confidence is formula-calculated (not LLM self-assessed).
- **Gemini retry**: If Gemini returns unparseable JSON, the request is retried once before failing — handles transient formatting errors.
- **Input sanitization**: Candidate and reference names are stripped of control characters and truncated to 100 chars before entering LLM prompts.
- **Structured logging**: All agent operations use Python's `logging` module with categorized error types (network, timeout, analysis failure).
- **No raw data persistence**: Raw CALL-E API responses are not stored in the database.

## Tests

```bash
python -m pytest tests/ -v
```

98 credential-free tests across three files — zero API keys needed:

- **test_guardrails.py** — LLM output validation: score clamping, fuzzy quote matching, coherence checks, confidence calculation, enum enforcement, input sanitization, end-to-end call/cross-reference validation
- **test_safety.py** — Safety boundaries: store schema (no raw_result column), DB operations, idempotency data, prompt identity verification ordering, transcript parsing, JSON response extraction, dry-run/live key gating, E.164 rejection, phone masking
- **test_integration.py** — Component integration: CALL-E wrapper payload construction, seed data hardcoded candidates, dashboard display mappings, config constants, radar chart polygon closure

## Side Effects

- **Phone calls**: `agent.py --live` places real phone calls via CALL-E. Each call costs 1 CALL-E credit. Default mode is dry-run (no calls).
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
└── tests/
    ├── test_guardrails.py  # LLM output validation tests
    ├── test_safety.py      # Safety boundary tests
    └── test_integration.py # Component integration tests
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
