<div align="center">
  <img src="public/logo.png" alt="Recover Logo" width="120" />
  <h1>Recover — AI Voice Payment Recovery Agent</h1>
  <p><strong>Built for the <a href="https://call-e.devpost.com/">CALL-E: &ldquo;Your Code Is Calling&rdquo; Hackathon</a></strong></p>
  <p><em>Catches failed subscription payments the instant they decline — and calls customers live to get a real decision.</em></p>
</div>

---

## 🎯 The Problem

Involuntary churn (failed cards) accounts for **20–40% of all SaaS subscription cancellations**. Every SaaS company sends dunning emails. Nobody reads them. Customers forget, subscriptions lapse, and revenue disappears silently.

**Recover** turns that silent failure into a real-time conversation.

---

## 💡 How It Works

```
Stripe payment fails
      │
      ▼
Recover catches the event instantly
      │
      ▼
AI agent calls the customer live (via CALL-E)
      │
      ▼
Customer says: "retry now" / "update card" / "pause"
      │
      ▼
Recover executes the action automatically
      │
      ▼
Revenue saved. Subscription preserved.
```

**Key differentiators:**
- **Real-time:** Call goes out within seconds of the failed charge, not 24h later
- **Conversational:** Customer explains their situation in plain language — expired card, wrong bank, travelling, etc.
- **Actionable:** Three structured outcomes (`retry_now`, `update_card`, `pause_subscription`) trigger real Stripe actions
- **Safe:** Every call requires explicit operator confirmation before CALL-E dials a real number
- **Persistent:** Missed calls auto-schedule follow-ups (up to 3 attempts) with full operator control

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────┐
│                     Frontend                        │
│  Next.js 16 App Router (React, TypeScript)          │
│  - Live dashboard with 3-second auto-refresh        │
│  - Metric cards: ARR recovered, at-risk, rate       │
│  - Operator safety gate (confirm before each call)  │
│  - Full call transcript + AI intelligence modal     │
└───────────────────────┬─────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────┐
│                    API Layer                        │
│  POST /api/stripe/simulate-failure  — demo trigger  │
│  POST /api/stripe/webhook           — real webhooks │
│  POST /api/calle/place-call         — place call    │
│  POST /api/calle/cancel-call        — cancel call   │
│  POST /api/calle/pause-followups    — stop chain    │
│  POST /api/calle/webhook            — receive result│
│  GET  /api/calls                    — call timeline │
│  GET  /api/subscribers              — account list  │
│  GET  /api/admin/metrics            — ROI summary   │
└───────────────────────┬─────────────────────────────┘
                        │
      ┌─────────────────┼─────────────────┐
      │                 │                 │
  ┌───▼───┐       ┌─────▼───┐      ┌─────▼──────┐
  │CALL-E │       │ Stripe  │      │  SQLite DB │
  │Voice  │       │ Test    │      │ (WAL mode) │
  │  API  │       │  Mode   │      └────────────┘
  └───────┘       └─────────┘
```

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **Safety Gate** | Every call shows the exact task text CALL-E will receive. No phone rings without operator ✓. |
| **ROI Dashboard** | Real-time metrics: ARR recovered, at-risk revenue, resolution rate, active interventions. |
| **AI Transcripts** | Full turn-by-turn conversation replay with timestamps and confidence scores. |
| **Follow-up Chains** | No answer? System auto-schedules up to 3 attempts, each requiring fresh confirmation. |
| **Smart Decision Parsing** | CALL-E extracts `retry_now`, `update_card`, `pause_subscription`, or `no_answer` from natural conversation. |
| **Automated Actions** | On `retry_now` → Stripe charge re-attempted. On `update_card` → Stripe Portal link dispatched. |
| **Region-aware Calling** | Validates phone numbers against CALL-E's supported regions before allowing calls. |
| **Judge Demo Mode** | "⚡ Load Demo Data" populates realistic completed calls with transcripts instantly. |

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- CALL-E API key ([request at call-e.devpost.com](https://call-e.devpost.com/))
- Stripe test-mode API keys

### Setup

```bash
git clone https://github.com/rehna-jp/Recover
cd Recover
npm install

cp .env.example .env.local
# Fill in your CALLE_API_KEY, STRIPE_SECRET_KEY, and APP_BASE_URL
```

### Exposing webhook endpoint for CALL-E (development)

```bash
# Forward CALL-E webhook to your local server
npx ngrok http 3000
# Paste the generated https:// URL into .env.local as APP_BASE_URL
```

### Running locally

```bash
npm run dev
# → http://localhost:3000
```

---

## 🔒 Security & Architecture Compliance

Recover is built to meet rigorous production security standards:
- **Authenticated REST APIs**: All administrative and operational endpoints require authorization (`x-recover-key` header or same-origin loopback).
- **Server-Bound Destination Enforcement**: Outbound calls cannot be pointed to arbitrary numbers by the client; destination numbers are strictly bound to server-validated subscriber records and enforced to strict ASCII E.164.
- **Authoritative Webhook Verification**: Webhooks are untrusted notifications. Recover never acts on or persists unverified caller-supplied transcripts/results—it re-fetches the authoritative call object directly from the CALL-E API before triggering Stripe actions.
- **PII Masking**: Customer phone numbers (`+1 276-***-**32`) and emails (`a***x@example.com`) are masked in APIs, UI, logs, and telemetry.
- **Conflict & Ambiguity Halting**: Duplicate subscriber creation and concurrent overlapping recovery calls are halted with `409 Conflict` to prevent double-charging or dual-dialing.
- **Bounded Follow-up Safety**: Bounded ceiling of 3 attempts maximum with exponential backoff and operator pause controls.
- **Honest Offline Demo Path**: Works completely out-of-the-box with zero live Stripe or CALL-E credentials. Both `npm run lint` and `npm run build` succeed cleanly in offline CI/CD pipelines.

---

## 🎬 Demo Flow (for judges)

1. Open the dashboard at `localhost:3000`
2. **Offline Simulation Ready**: If no API keys are provided, Recover runs an honest, fully interactive local simulation.
3. Click **"⚡ Load Demo Data"** — see 3 realistic scenarios:
   - ✅ **Sarah Jenkins** — Called, authorized retry, $490 recovered
   - ✅ **Marcus Vance** — Called, requested card update link, SMS sent
   - 🔄 **Elena Rostova** — Missed first call, follow-up queued for attempt 2
4. Click **"🎙 Conversation"** on any completed call to see the full AI transcript + confidence score
5. For a live or simulated flow: Add a subscriber → click "⚡ Simulate Stripe failure" → review the safety gate → click "Confirm & place call"

> **Note:** Live carrier calls use the official CALL-E developer test number (`+12763229632`) reserved for testing.

---

## 🧪 Build & Lint Commands

```bash
# Linting (0 errors)
npm run lint

# Production Build (offline type-check + page generation)
npm run build
```

---

## 📁 Key Files

```
app/
  page.tsx                    — Full dashboard UI (client component)
  api/
    stripe/simulate-failure/  — Demo: triggers a real Stripe test decline
    stripe/webhook/           — Production: handles real Stripe invoice events
    calle/place-call/         — Places a confirmed CALL-E voice call
    calle/webhook/            — Receives CALL-E call result + transcript
    calle/cancel-call/        — Discards a pending call preview
    calle/pause-followups/    — Stops the follow-up chain for a subscriber
    admin/metrics/            — ROI dashboard data
    admin/demo-data/          — Judge demo dataset (seed / reset)
lib/
  calle.ts                    — CALL-E SDK wrapper + task builder
  db.ts                       — SQLite schema, queries, seed data
  stripe.ts                   — Stripe client + test decline scenarios
```

---

## 🌍 CALL-E Supported Regions

Recover respects CALL-E's carrier network coverage. Phone numbers must be from one of these regions:

🇺🇸 US · 🇨🇦 CA · 🇬🇧 GB · 🇦🇺 AU · 🇸🇬 SG · 🇲🇾 MY · 🇮🇳 IN · 🇦🇪 AE · 🇻🇳 VN · 🇩🇪 DE · 🇫🇷 FR · 🇲🇽 MX · 🇧🇷 BR · 🇮🇩 ID · 🇵🇭 PH · 🇰🇪 KE

---

## 🏆 Hackathon Context

Built for the **CALL-E: "Your Code Is Calling"** hackathon (Devpost, September 2026).

**Category targeted:** Best Business / SaaS Agent  
**Prize pool:** $10,000  
**Judging criteria:** Impact, Technical difficulty, Originality, Applicability

**Why Recover wins on each criterion:**
- **Impact:** Recovers 20–40% of SaaS involuntary churn. Measurable, immediate, high-dollar ROI.
- **Technical difficulty:** Real Stripe webhooks, structured LLM parsing, automated action execution, safety-gated human-in-the-loop, multi-attempt follow-up chains.
- **Originality:** Dunning voice agents don't exist as a product. Email-only dunning is a solved (mediocre) problem. Voice is 10x more effective and 0x adopted.
- **Applicability:** Every SaaS company has this problem today.

---

## 📄 License

MIT