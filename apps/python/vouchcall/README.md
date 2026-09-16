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
2. **CALL-E calls each reference** — first verifies recipient identity, then asks for explicit consent to AI analysis before proceeding with a structured interview asking about strengths, teamwork, reliability, growth areas, and a 1-10 recommendation
3. **Call quality assessment** determines the outcome: `verified` (full interview), `partial` (too few questions answered), `insufficient` (too few turns), `no_consent` (declined AI analysis — permanent, never re-called), or `wrong_person` (retryable on next run). Identity confirmation and consent detection are handled entirely by Gemini LLM — no keyword matching.
4. **Gemini analyzes verified transcripts** and extracts scores across 5 dimensions (collaboration, technical ability, reliability, communication, leadership), plus evidence-grounded strengths, growth areas, and key quotes
5. **7-layer LLM guardrails validate every output** — scores are clamped to 1-10, key quotes are fuzzy-matched against the actual transcript (threshold 0.65 — fabricated quotes are dropped), evidence per dimension is validated and ungrounded scores are zeroed, score-recommendation coherence is enforced, and confidence is formula-calculated from weighted inter-reference variance
6. **Relation-weighted cross-reference analysis** compares only verified references, weighting each by their relationship to the candidate (manager 1.5×, skip-level 1.3×, team lead 1.1×, peer 1.0×) and call completeness. Discrepancies are flagged (e.g., one reference rates reliability 9/10 while another rates it 5/10)
7. **Dashboard** shows a radar chart comparison, per-reference details with quality badges, excluded references section, and a final hire recommendation with confidence score

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
VOUCHCALL_ENCRYPTION_KEY=your_encryption_key
```

Generate an encryption key with: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`

### Credentials

| Variable | Source | Required |
|---|---|---|
| `CALLE_API_KEY` | [CALL-E Dashboard](https://dashboard.heycall-e.com) → API Keys | Yes |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) | Yes |
| `TEST_PHONE` | Your phone number for testing | For tests only |
| `VOUCHCALL_ENCRYPTION_KEY` | Generated Fernet key (see above) | Recommended |

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
python agent.py <candidate_id> --live --fail-fast
```

Places real CALL-E calls to each reference, analyzes results with Gemini, and stores everything in the database. Requires `CALLE_API_KEY` and `GEMINI_API_KEY`. Each reference uses 1 CALL-E credit.

The `--fail-fast` flag stops on the first error or ambiguous call result.

### Dashboard

```bash
streamlit run dashboard.py
```

Opens the reference comparison dashboard with radar chart, per-reference details, and cross-reference analysis.

## Safety & Guardrails

- **Safe by default**: `agent.py` runs in dry-run mode. Real calls require the explicit `--live` flag and valid API keys.
- **Consent flow**: The AI asks for explicit consent to AI analysis before proceeding. If the reference declines, the call ends gracefully and the reference is permanently marked `no_consent` (never re-called).
- **Recipient verification**: The AI verifies the recipient's identity before disclosing any candidate or role details. Wrong-person calls are marked retryable.
- **5-tier quality assessment**: Every completed call is classified as `verified`, `partial`, `insufficient`, `no_consent`, or `wrong_person`. Only `verified` calls feed into Gemini analysis.
- **LLM-only identity and consent checking**: Identity confirmation and consent detection are handled entirely by Gemini — no brittle keyword matching. Each check sends the first 10 transcript lines to Gemini with a yes/no question. Fails closed on API errors (returns `False`).
- **Candidate consent gate**: Live calls require explicit candidate consent (`store.record_candidate_consent()`). Without it, `agent.py --live` refuses to proceed.
- **E.164 phone validation**: Phone numbers are validated before any call is placed. Invalid numbers are skipped.
- **Stable idempotency keys with reconciliation**: Each call gets a key `vouchcall_{cid}_{rid}_g{confirmed_failures}` — same intent produces the same key so CALL-E deduplicates. Only confirmed failures (`wrong_person`, `no_consent`) advance the generation; ambiguous timeouts and network errors hold the key stable. Before redialing, `_reconcile_ambiguous_call()` checks CALL-E's API for the real status of the last ambiguous call — if it actually completed, that result is used instead of placing a new call.
- **Call-to-request binding**: Before any call enters analysis, `_bind_call_to_request()` reads `recipients[].phones` (the actual CALL-E SDK response shape) and verifies the first phone matches what was dialed, that the response contains recipients and attempts, and that a non-empty transcript exists. Fails closed: missing/empty `phones` list, mismatched phone, or empty transcript all reject the call as `insufficient` — no hiring recommendation is produced from unbound data.
- **CALL-E completion confidence**: Logged from CALL-E's `completion_confidence` (score 0-1, label low/medium/high) for observability.
- **Relation-weighted scoring**: Manager references carry 1.5× weight, skip-level 1.3×, peers 1.0×. Partial calls are discounted by `questions_answered / expected_questions`. Weights feed into both confidence calculation (weighted variance) and the cross-analysis LLM prompt.
- **Permanent vs retryable statuses**: `no_consent` is permanent (skip on all future runs, matched by ref ID to avoid name-collision bugs). `wrong_person` and `insufficient` are retryable on the next run.
- **Field-level encryption with key validation**: Phone numbers and transcripts are encrypted at rest with Fernet (AES-128-CBC) via `VOUCHCALL_ENCRYPTION_KEY`. The key format is validated at startup — an invalid Fernet key causes `SystemExit` before any calls are placed, preventing data loss from encryption failures mid-pipeline. Without the key, data is stored in plaintext (graceful degradation for demo mode).
- **Phone separation**: `get_references()` returns masked phones for display/logging. `get_references_for_calling()` returns decrypted phones only when live calls are needed.
- **Evidence grounding**: Gemini returns a transcript excerpt per dimension score. Each excerpt is fuzzy-matched against the transcript — ungrounded scores are zeroed.
- **Phone masking**: All console output shows masked phone numbers (e.g., `********1234`).
- **LLM output validation**: Scores are clamped 1-10, recommendations are enum-constrained, key quotes are verified against the transcript via fuzzy matching (threshold 0.65), score-recommendation contradictions are auto-corrected, and confidence is formula-calculated (not LLM self-assessed).
- **Gemini retry**: If Gemini returns unparseable JSON, the request is retried once before failing — handles transient formatting errors.
- **Input sanitization**: Candidate and reference names are stripped of control characters and truncated to 100 chars before entering LLM prompts.
- **Structured logging**: All agent operations use Python's `logging` module with categorized error types (network, timeout, analysis failure).
- **No raw data persistence**: Raw CALL-E API responses are not stored in the database.
- **Fail-fast mode**: `--fail-fast` flag stops on the first error or ambiguous result, useful for debugging.

## Tests

```bash
python -m pytest tests/ -v
```

206 credential-free tests across three files — zero API keys needed:

- **test_guardrails.py** (98 tests) — LLM output validation: score clamping, fuzzy quote matching (0.65 threshold), coherence checks, weighted confidence calculation, relation-based weighting (`_ref_weight` for manager/peer/skip-level), enum enforcement, input sanitization, evidence grounding validation, transcript turn counting, question-answer counting, LLM-based identity/consent checks (mocked Gemini), quality status constants
- **test_safety.py** (84 tests) — Safety boundaries: store schema (quality_status column, no raw_result), DB operations, candidate consent gate (`record_candidate_consent`/`has_candidate_consent`), `count_calls_for_ref` and `count_confirmed_failures_for_ref` for idempotency keys, `get_last_call_id_for_ref`/`get_call_status_for_ref` for reconciliation, phone encryption at rest, transcript encryption/decryption, masked vs real phone getters, quality-based ref queries (by ref ID), migration idempotency, Fernet encrypt/decrypt roundtrips, wrong-key fail-closed, encryption key format validation at startup, prompt consent/identity ordering, LLM identity/consent mocking (always-calls-LLM, yes/no/error), `assess_call_quality` for all 5 quality statuses, permanent vs retryable status constants, call-to-request binding (reads `recipients[].phones` per CALL-E SDK, phone match, empty/missing phones fail-closed, no recipients, no attempts, formatting tolerance), ambiguous call reconciliation (no prior call, error sentinel, completed skip, reconcile to completed/failed, API error handling)
- **test_integration.py** (24 tests) — Component integration: CALL-E wrapper payload construction with idempotency key passthrough, seed data with quality_status and no_consent references, candidate consent in seed data, Ryan Cooper's Kevin Park excluded, Alex transcript consent verification, dashboard quality display mappings, config constants including encryption and quality thresholds

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
- **cryptography (Fernet)** — Field-level encryption for phones and transcripts at rest
