# LeadIQ — Autonomous CALL-E Voice Lead Qualification & Sales Routing Agent

> **CALL-E Hackathon Submission** · Most Practical Use Case · Most Innovative Use Case

## What It Does

LeadIQ turns CALL-E into a 24/7 autonomous phone outreach team. It:

1. **Dials** prospect lists (CSV or web form) with E.164 normalization & idempotency protection
2. **Qualifies** via natural voice conversation — budget, timeline, decision-maker, pain points
3. **Analyzes** transcripts with **Gemini 2.0 Flash** → structured JSON buying signals
4. **Routes** hot leads (fit >80%) to Senior AEs via Slack with a **2-hour SLA**
5. **Persists** everything to SQLite + Google Sheets with a glassmorphic live dashboard

## Architecture

```
CSV/Form → Idempotency Guard → CALL-E /v1/calls → Voice Call
                                                        ↓
                                         Gemini 2.0 Flash Qualifier
                                                        ↓
                    Hot (>80%) → Senior AE · Slack Alert · 2h SLA
                    Warm (50-80%) → Mid-Market AE · 24h SLA  
                    Cold (<50%) → Automated Email Drip
                                                        ↓
                                    SQLite + Google Sheets + Dashboard
```

## Quick Start

```bash
git clone https://github.com/saurabhhhcodes/leadiq-call-e-agent
cd leadiq-call-e-agent
pip install -r requirements.txt
cp .env.template .env   # add GEMINI_API_KEY + CALLE_API_KEY
python3 app.py          # → http://localhost:3000
```

## Live Demo

- **Dashboard**: https://leadiq-calle-agent.netlify.app
- **GitHub**: https://github.com/saurabhhhcodes/leadiq-call-e-agent
- **Devpost**: https://devpost.com/software/leadiq-autonomous-call-e-voice-lead-qualification-sales

## Key Technical Highlights

- **Direct CALL-E API** — `/v1/calls` with bearer auth, `result_schema`, metadata, webhook callbacks
- **Multi-tier AI fallback** — Gemini 2.0 Flash → Ollama (llama3) → deterministic heuristics
- **15/15 tests passing** on Python 3.9+
- **Dry-run mode** — safe demos without placing real calls (toggle in UI)
- **Webhook handler** — `/calle/webhook` processes async call completions
